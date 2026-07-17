import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OrbitDbWorkflowStore } from '../src/mastra/orbitdb/client';
import { createWorkflowState } from '../src/mastra/orbitdb/workflow-state';

const REPLICATION_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 200;

async function waitFor<T>(
  description: string,
  read: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + REPLICATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await read();
    if (result !== undefined) {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out after ${REPLICATION_TIMEOUT_MS}ms waiting for ${description}.`);
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'a2a-orbitdb-smoke-'));
  const taskId = `replication-smoke-${Date.now()}`;
  let alpha: OrbitDbWorkflowStore | undefined;
  let bravo: OrbitDbWorkflowStore | undefined;

  console.log('[Framework Test][OrbitDB] Starting two isolated local replicas.');

  try {
    alpha = await OrbitDbWorkflowStore.create({
      nodeId: 'Test Alpha',
      dataDirectory: path.join(root, 'alpha'),
      databaseName: `framework-smoke-${Date.now()}`,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
    });

    const alphaAddress = alpha.listenMultiaddresses.find(address =>
      address.startsWith('/ip4/127.0.0.1/'),
    );
    assert.ok(alphaAddress, 'Alpha did not publish a loopback libp2p multiaddress.');

    bravo = await OrbitDbWorkflowStore.create({
      nodeId: 'Test Bravo',
      dataDirectory: path.join(root, 'bravo'),
      databaseAddress: alpha.databaseAddress,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      bootstrapMultiaddresses: [alphaAddress],
    });

    const staleHeartbeat = Date.now() - 10_000;
    await alpha.putTask({
      ...createWorkflowState({
        taskId,
        assignedNode: 'Test Alpha',
        rawTranscript: 'Fictional smoke-test transcript.',
        now: staleHeartbeat,
      }),
      status: 'in_progress',
      lastHeartbeat: staleHeartbeat,
    });

    const replicatedOnBravo = await waitFor('Alpha task to replicate to Bravo', async () => {
      const task = await bravo?.getTask(taskId);
      return task?.assignedNode === 'Test Alpha' ? task : undefined;
    });
    assert.equal(replicatedOnBravo.status, 'in_progress');
    console.log('[Framework Test][OrbitDB] PASS Alpha -> Bravo task replication.');

    const claimed = await bravo.claimTimedOutTask(taskId, 'Test Bravo', 5_000);
    assert.ok(claimed, 'Bravo did not claim the stale Alpha task.');
    assert.equal(claimed.claimedFrom, 'Test Alpha');

    const replicatedBackToAlpha = await waitFor('Bravo claim to replicate back to Alpha', async () => {
      const task = await alpha?.getTask(taskId);
      return task?.assignedNode === 'Test Bravo' ? task : undefined;
    });
    assert.equal(replicatedBackToAlpha.claimedFrom, 'Test Alpha');
    console.log('[Framework Test][OrbitDB] PASS Bravo -> Alpha failover claim replication.');
  } finally {
    await bravo?.close().catch(error =>
      console.error('[Framework Test][OrbitDB] Bravo cleanup warning:', error),
    );
    await alpha?.close().catch(error =>
      console.error('[Framework Test][OrbitDB] Alpha cleanup warning:', error),
    );
    await rm(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error('[Framework Test][OrbitDB] FAIL', error);
  process.exitCode = 1;
});

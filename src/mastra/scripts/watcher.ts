import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { mastra } from '../index';
import {
  closeOrbitDbWorkflowStore,
  getOrbitDbWorkflowStore,
  type OrbitDbWorkflowStore,
} from '../orbitdb/client';
import { createWorkflowState, type WorkflowState } from '../orbitdb/workflow-state';
import { findFailoverCandidates, findLocallyAssignedTasks } from './failover-policy';

const WATCH_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_HANDOFF_GRACE_MS = 750;
const DEFAULT_FAILOVER_NODE_ID = 'Node Bravo';

function requiredNodeId(): string {
  const nodeId = process.env.NODE_ID?.trim();
  if (!nodeId) {
    throw new Error('NODE_ID is required. Use "Node Alpha" on the Mac and "Node Bravo" on Windows.');
  }
  return nodeId;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function failoverNodeId(nodeId: string): string | undefined {
  const configured = process.env.KILL_SWITCH_FAILOVER_NODE_ID?.trim();
  const target = configured || (nodeId === 'Node Alpha' ? DEFAULT_FAILOVER_NODE_ID : undefined);
  return target && target !== nodeId ? target : undefined;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function runWorkflow(task: WorkflowState, store: OrbitDbWorkflowStore): Promise<void> {
  const nodeId = requiredNodeId();
  console.log(`[Mastra][${nodeId}] Creating workflow run for task=${task.taskId}.`);
  console.log(
    `[Mastra][${nodeId}] Injecting OrbitDB checkpoint as BOTH inputData and initialState (SAL=${Boolean(
      task.extractedSAL,
    )}, UTE=${Boolean(task.extractedUTE)}, SITREP=${Boolean(task.finalSitrep)}).`,
  );

  const workflow = mastra.getWorkflow('killSwitchWorkflow');
  const run = await workflow.createRun({
    runId: `${task.taskId}-${nodeId.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`,
  });
  const result = await run.start({
    inputData: task,
    initialState: task,
  });

  if (result.status !== 'success') {
    console.error(`[Mastra][${nodeId}] Workflow task=${task.taskId} ended with status=${result.status}.`, result);
    return;
  }

  const completed = await store.getTask(task.taskId);
  console.log(
    `[Mastra][${nodeId}] Workflow run succeeded. Replicated status=${completed?.status ?? 'missing'} task=${task.taskId}.`,
  );
}

async function readInitialTranscript(): Promise<string> {
  const fileArgument = argumentValue('--transcript-file');
  const configuredFile = fileArgument ?? process.env.KILL_SWITCH_TRANSCRIPT_FILE?.trim();
  if (configuredFile) {
    const absolutePath = path.resolve(configuredFile);
    console.log(`[Demo] Loading radio transcript from ${absolutePath}`);
    return (await readFile(absolutePath, 'utf8')).trim();
  }

  const transcript = process.env.KILL_SWITCH_RAW_TRANSCRIPT?.trim();
  if (!transcript) {
    throw new Error(
      'Starting a task requires --transcript-file, KILL_SWITCH_TRANSCRIPT_FILE, or KILL_SWITCH_RAW_TRANSCRIPT.',
    );
  }
  return transcript;
}

async function startAlphaTask(store: OrbitDbWorkflowStore, runningTasks: Set<string>): Promise<void> {
  const nodeId = requiredNodeId();
  const rawTranscript = await readInitialTranscript();
  const taskId = argumentValue('--task-id') ?? process.env.KILL_SWITCH_TASK_ID?.trim() ?? 'sitrep-demo-001';
  const existing = await store.getTask(taskId);

  if (existing?.status === 'completed') {
    throw new Error(
      `Task ${taskId} is already completed. Change --task-id or KILL_SWITCH_TASK_ID for another rehearsal.`,
    );
  }

  if (!existing) {
    await store.putTask(createWorkflowState({ taskId, assignedNode: nodeId, rawTranscript }));
    console.log(`[${nodeId}] Created pending task=${taskId} in local OrbitDB.`);
  }

  const claimed = await store.updateTask(taskId, current => ({
    ...current,
    assignedNode: nodeId,
    status: 'in_progress',
    lastHeartbeat: Date.now(),
    claimedFrom: current.assignedNode === nodeId ? current.claimedFrom : current.assignedNode,
  }));

  if (!claimed) {
    throw new Error(`Unable to start task ${taskId}.`);
  }

  console.log(`[${nodeId}] STARTING KILL-SWITCH TASK ${taskId}.`);
  runningTasks.add(taskId);
  void runWorkflow(claimed, store)
    .catch(error => {
      console.error(`[Mastra][${nodeId}] Task ${taskId} failed.`, error);
    })
    .finally(() => runningTasks.delete(taskId));
}

async function handoffActiveTasks(store: OrbitDbWorkflowStore, nodeId: string): Promise<number> {
  const targetNodeId = failoverNodeId(nodeId);
  if (!targetNodeId) {
    return 0;
  }

  const tasks = await store.listTasks();
  const activeTasks = tasks.filter(
    task => task.status === 'in_progress' && task.assignedNode === nodeId,
  );
  let handedOff = 0;

  for (const task of activeTasks) {
    const updated = await store.updateTask(task.taskId, current => {
      if (current.status !== 'in_progress' || current.assignedNode !== nodeId) {
        return undefined;
      }

      return {
        ...current,
        assignedNode: targetNodeId,
        claimedFrom: nodeId,
        lastHeartbeat: Date.now(),
      };
    });

    if (updated) {
      handedOff += 1;
      console.log(
        `[OrbitDB][${nodeId}] GRACEFUL HANDOFF COMMITTED: ${nodeId} -> ${targetNodeId} task=${task.taskId}`,
      );
    }
  }

  return handedOff;
}

async function main(): Promise<void> {
  const nodeId = requiredNodeId();
  const timeoutMs = positiveNumber(process.env.KILL_SWITCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const store = await getOrbitDbWorkflowStore();
  const runningTasks = new Set<string>();
  const taskStartRequests = new Set<Promise<void>>();
  let scanActive = false;
  let shuttingDown = false;

  const requestTaskStart = (): Promise<void> => {
    const request = startAlphaTask(store, runningTasks);
    taskStartRequests.add(request);
    void request.then(
      () => taskStartRequests.delete(request),
      () => taskStartRequests.delete(request),
    );
    return request;
  };

  console.log('============================================================');
  console.log(`[Watcher][${nodeId}] KILL-SWITCH WATCHER ONLINE`);
  console.log(`[Watcher][${nodeId}] Scan interval=${WATCH_INTERVAL_MS}ms timeout=${timeoutMs}ms`);
  console.log(`[Watcher][${nodeId}] Waiting for replicated in-progress tasks owned by another node.`);
  console.log('============================================================');

  const scan = async (): Promise<void> => {
    if (scanActive || shuttingDown) {
      return;
    }
    scanActive = true;

    try {
      const tasks = await store.listTasks();
      const assignedTasks = findLocallyAssignedTasks(tasks, nodeId);
      const candidates = findFailoverCandidates(tasks, nodeId, timeoutMs);

      for (const assignedTask of assignedTasks) {
        if (runningTasks.has(assignedTask.taskId)) {
          continue;
        }

        console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        console.log(
          `[${nodeId}] ACCEPTING GRACEFUL HANDOFF FOR TASK ${assignedTask.taskId} FROM ${
            assignedTask.claimedFrom ?? 'ANOTHER NODE'
          }...`,
        );
        console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');

        runningTasks.add(assignedTask.taskId);
        void runWorkflow(assignedTask, store)
          .catch(error => {
            console.error(`[Mastra][${nodeId}] Assigned workflow failed for task=${assignedTask.taskId}.`, error);
          })
          .finally(() => runningTasks.delete(assignedTask.taskId));
      }

      for (const staleTask of candidates) {
        if (runningTasks.has(staleTask.taskId)) {
          continue;
        }

        const ageMs = Date.now() - staleTask.lastHeartbeat;
        console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        console.log(
          `[${nodeId}] DETECTED ${staleTask.assignedNode} TIMEOUT (${ageMs}ms). CLAIMING TASK ${staleTask.taskId}...`,
        );
        console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');

        const claimed = await store.claimTimedOutTask(staleTask.taskId, nodeId, timeoutMs);
        if (!claimed) {
          console.log(`[Watcher][${nodeId}] Claim skipped; a fresher CRDT update won the race.`);
          continue;
        }

        console.log(
          `[OrbitDB][${nodeId}] OWNERSHIP TRANSFER COMMITTED: ${claimed.claimedFrom} -> ${claimed.assignedNode}`,
        );
        runningTasks.add(claimed.taskId);
        void runWorkflow(claimed, store)
          .catch(error => {
            console.error(`[Mastra][${nodeId}] Failover workflow failed for task=${claimed.taskId}.`, error);
          })
          .finally(() => runningTasks.delete(claimed.taskId));
      }
    } catch (error) {
      console.error(`[Watcher][${nodeId}] Scan failed; retrying in ${WATCH_INTERVAL_MS}ms.`, error);
    } finally {
      scanActive = false;
    }
  };

  const timer = setInterval(() => void scan(), WATCH_INTERVAL_MS);
  await scan();

  if (process.argv.includes('--start-task') || process.env.KILL_SWITCH_START_TASK === 'true') {
    await requestTaskStart();
  }

  const terminal = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stdout, prompt: `[${nodeId}] command> ` })
    : undefined;
  if (terminal) {
    console.log(`[Watcher][${nodeId}] Commands: start | status | quit | help`);
    console.log(`[Watcher][${nodeId}] Type quit (or q) at any time; active work will hand off before exit.`);
    terminal.prompt();
    terminal.on('line', line => {
      const command = line.trim().toLowerCase();
      if (command === 'quit' || command === 'q' || command === 'exit') {
        void requestExit('quit command');
        return;
      }
      if (command === 'start') {
        void requestTaskStart()
          .catch(error => console.error(`[Demo][${nodeId}] Unable to start task.`, error))
          .finally(() => terminal.prompt());
        return;
      }
      if (command === 'status') {
        void store
          .listTasks()
          .then(tasks => console.log(`[Watcher][${nodeId}] ${JSON.stringify(tasks, null, 2)}`))
          .finally(() => terminal.prompt());
        return;
      }
      if (command && command !== 'help') {
        console.log(`[Watcher][${nodeId}] Unknown command '${command}'.`);
      }
      console.log(`[Watcher][${nodeId}] Commands: start | status | quit | help`);
      terminal.prompt();
    });
  }

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (reason: string): Promise<void> => {
    shutdownPromise ??= (async () => {
      shuttingDown = true;
      clearInterval(timer);
      terminal?.close();
      console.log(`[Watcher][${nodeId}] Received ${reason}; preparing a safe shutdown.`);

      if (taskStartRequests.size > 0) {
        console.log(`[Watcher][${nodeId}] Finishing task registration before handoff.`);
        await Promise.allSettled([...taskStartRequests]);
      }

      const handedOff = await handoffActiveTasks(store, nodeId);
      if (handedOff > 0) {
        const graceMs = nonNegativeNumber(
          process.env.KILL_SWITCH_HANDOFF_GRACE_MS,
          DEFAULT_HANDOFF_GRACE_MS,
        );
        console.log(
          `[Watcher][${nodeId}] Waiting ${graceMs}ms for ${handedOff} handoff update(s) to reach the peer.`,
        );
        await new Promise(resolve => setTimeout(resolve, graceMs));
      }

      await closeOrbitDbWorkflowStore();
    })();
    return shutdownPromise;
  };

  const requestExit = (reason: string): void => {
    void shutdown(reason)
      .then(() => process.exit(0))
      .catch(error => {
        console.error(`[Watcher][${nodeId}] Safe shutdown failed.`, error);
        process.exit(1);
      });
  };

  process.once('SIGINT', () => requestExit('SIGINT'));
  process.once('SIGTERM', () => requestExit('SIGTERM'));
  process.once('SIGHUP', () => requestExit('SIGHUP'));
}

main().catch(async error => {
  console.error('[Kill Switch] Fatal watcher error.', error);
  await closeOrbitDbWorkflowStore().catch(() => undefined);
  process.exitCode = 1;
});

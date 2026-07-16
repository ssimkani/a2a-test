import { gossipsub } from '@libp2p/gossipsub';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { tcp } from '@libp2p/tcp';
import { createOrbitDB, Documents, IPFSAccessController } from '@orbitdb/core';
import type { OrbitDbDocuments, OrbitDbInstance } from '@orbitdb/core';
import { LevelBlockstore } from 'blockstore-level';
import { LevelDatastore } from 'datastore-level';
import { createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { withLibp2p, type HeliaWithLibp2p } from '@helia/libp2p';
import * as dagCbor from '@ipld/dag-cbor';
import { multiaddr } from '@multiformats/multiaddr';
import path from 'node:path';
import { workflowStateSchema, type WorkflowState } from './workflow-state';

const DEFAULT_DATABASE_NAME = 'kill-switch-workflow-state';

export interface OrbitDbWorkflowStoreOptions {
  nodeId: string;
  dataDirectory: string;
  databaseAddress?: string;
  databaseName?: string;
  listenAddresses?: string[];
  bootstrapMultiaddresses?: string[];
}

function peerLabel(peerId: unknown): string {
  if (peerId && typeof peerId === 'object' && 'toString' in peerId) {
    return String(peerId);
  }

  return String(peerId);
}

function cleanList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function safeDirectoryName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function orbitDbOptionsFromEnvironment(): OrbitDbWorkflowStoreOptions {
  const nodeId = process.env.NODE_ID?.trim();
  if (!nodeId) {
    throw new Error('NODE_ID is required (for example, NODE_ID="Node Alpha" or NODE_ID="Node Bravo").');
  }

  return {
    nodeId,
    dataDirectory:
      process.env.ORBITDB_DATA_DIR?.trim() || path.resolve('.orbitdb', safeDirectoryName(nodeId)),
    databaseAddress: process.env.ORBITDB_DATABASE_ADDRESS?.trim() || undefined,
    databaseName: process.env.ORBITDB_DATABASE_NAME?.trim() || DEFAULT_DATABASE_NAME,
    listenAddresses: cleanList(process.env.ORBITDB_LISTEN_ADDRESSES).length
      ? cleanList(process.env.ORBITDB_LISTEN_ADDRESSES)
      : ['/ip4/0.0.0.0/tcp/0'],
    bootstrapMultiaddresses: cleanList(process.env.ORBITDB_BOOTSTRAP_MULTIADDRS),
  };
}

export class OrbitDbWorkflowStore {
  readonly nodeId: string;
  readonly databaseAddress: string;
  readonly peerId: string;
  readonly listenMultiaddresses: string[];

  private readonly database: OrbitDbDocuments<WorkflowState>;
  private readonly orbitdb: OrbitDbInstance;
  private readonly helia: HeliaWithLibp2p;
  private readonly updateQueues = new Map<string, Promise<unknown>>();
  private closed = false;

  private constructor(options: {
    nodeId: string;
    database: OrbitDbDocuments<WorkflowState>;
    orbitdb: OrbitDbInstance;
    helia: HeliaWithLibp2p;
  }) {
    this.nodeId = options.nodeId;
    this.database = options.database;
    this.orbitdb = options.orbitdb;
    this.helia = options.helia;
    this.databaseAddress = options.database.address;
    this.peerId = options.helia.libp2p.peerId.toString();
    this.listenMultiaddresses = options.helia.libp2p
      .getMultiaddrs()
      .map(address => address.toString());
  }

  static async create(options: OrbitDbWorkflowStoreOptions): Promise<OrbitDbWorkflowStore> {
    const blockstore = new LevelBlockstore(path.join(options.dataDirectory, 'helia-blocks'));
    const datastore = new LevelDatastore(path.join(options.dataDirectory, 'helia-data'));
    const networkedHelia = withLibp2p(
      createHeliaLight({
        blockstore,
        datastore,
        codecs: [dagCbor],
      }),
      {
        addresses: {
          listen: options.listenAddresses ?? ['/ip4/0.0.0.0/tcp/0'],
        },
        transports: [tcp()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: {
          identify: identify(),
          pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }),
        },
      },
    );
    // withBitswap's published type currently fixes the default libp2p service
    // map even though the runtime accepts a custom service map.
    const helia = withBitswap(networkedHelia as unknown as HeliaWithLibp2p);

    await helia.start();

    for (const address of options.bootstrapMultiaddresses ?? []) {
      try {
        console.log(`[OrbitDB][${options.nodeId}] Dialing peer ${address}`);
        await helia.libp2p.dial(multiaddr(address));
        console.log(`[OrbitDB][${options.nodeId}] Connected to peer ${address}`);
      } catch (error) {
        console.error(`[OrbitDB][${options.nodeId}] Initial peer dial failed; watcher will remain online.`, error);
      }
    }

    const orbitdb = await createOrbitDB({
      ipfs: helia,
      id: options.nodeId,
      directory: path.join(options.dataDirectory, 'orbitdb'),
    });

    try {
      const database = await orbitdb.open<WorkflowState>(
        options.databaseAddress ?? options.databaseName ?? DEFAULT_DATABASE_NAME,
        {
          type: 'documents',
          Database: Documents({ indexBy: 'taskId' }),
          // This wildcard is intentionally demo-only. The runbook explains how
          // to replace it with explicit OrbitDB identities for real deployments.
          AccessController: IPFSAccessController({ write: ['*'] }),
          sync: true,
        },
      );

      const store = new OrbitDbWorkflowStore({ nodeId: options.nodeId, database, orbitdb, helia });
      store.attachReplicationLogs();
      store.printStartupBanner(options.dataDirectory);
      return store;
    } catch (error) {
      await orbitdb.stop().catch(() => undefined);
      await helia.stop().catch(() => undefined);
      throw new Error(
        `Unable to open OrbitDB workflow database. If this is Node Bravo, verify ORBITDB_DATABASE_ADDRESS and that Node Alpha is reachable for the first sync.`,
        { cause: error },
      );
    }
  }

  async getTask(taskId: string): Promise<WorkflowState | undefined> {
    const entry = await this.database.get(taskId);
    return entry ? workflowStateSchema.parse(entry.value) : undefined;
  }

  async listTasks(): Promise<WorkflowState[]> {
    const entries = await this.database.all();
    return entries.map(entry => workflowStateSchema.parse(entry.value));
  }

  async putTask(task: WorkflowState): Promise<WorkflowState> {
    const parsed = workflowStateSchema.parse(task);
    await this.database.put(parsed);
    console.log(
      `[OrbitDB][${this.nodeId}] PUT task=${parsed.taskId} status=${parsed.status} owner=${parsed.assignedNode} revision=${parsed.revision}`,
    );
    return parsed;
  }

  async updateTask(
    taskId: string,
    updater: (current: WorkflowState) => WorkflowState | undefined,
  ): Promise<WorkflowState | undefined> {
    return this.serializeTaskUpdate(taskId, async () => {
      const current = await this.getTask(taskId);
      if (!current) {
        throw new Error(`OrbitDB task '${taskId}' does not exist.`);
      }

      const requested = updater(current);
      if (!requested) {
        return undefined;
      }

      const now = Date.now();
      return this.putTask({
        ...requested,
        taskId: current.taskId,
        revision: Math.max(current.revision + 1, requested.revision),
        updatedAt: now,
      });
    });
  }

  async touchHeartbeat(taskId: string, nodeId = this.nodeId): Promise<WorkflowState | undefined> {
    return this.updateTask(taskId, current => {
      if (current.status !== 'in_progress' || current.assignedNode !== nodeId) {
        return undefined;
      }

      return { ...current, lastHeartbeat: Date.now() };
    });
  }

  async claimTimedOutTask(
    taskId: string,
    newNodeId: string,
    timeoutMs: number,
    now = Date.now(),
  ): Promise<WorkflowState | undefined> {
    return this.updateTask(taskId, current => {
      const timedOut = now - current.lastHeartbeat > timeoutMs;
      if (current.status !== 'in_progress' || current.assignedNode === newNodeId || !timedOut) {
        return undefined;
      }

      return {
        ...current,
        assignedNode: newNodeId,
        claimedFrom: current.assignedNode,
        lastHeartbeat: now,
      };
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    console.log(`[OrbitDB][${this.nodeId}] Closing local replica cleanly...`);
    await this.orbitdb.stop();
    await this.helia.stop();
  }

  private async serializeTaskUpdate<T>(taskId: string, update: () => Promise<T>): Promise<T> {
    const previous = this.updateQueues.get(taskId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(update);
    this.updateQueues.set(taskId, current);

    try {
      return await current;
    } finally {
      if (this.updateQueues.get(taskId) === current) {
        this.updateQueues.delete(taskId);
      }
    }
  }

  private attachReplicationLogs(): void {
    this.database.events.on('join', peerId => {
      console.log(`[OrbitDB][${this.nodeId}] REPLICATION PEER JOINED: ${peerLabel(peerId)}`);
    });
    this.database.events.on('leave', peerId => {
      console.log(`[OrbitDB][${this.nodeId}] Replication peer left: ${peerLabel(peerId)}`);
    });
    this.database.events.on('update', async () => {
      const tasks = await this.listTasks().catch(() => []);
      const summary = tasks.map(task => `${task.taskId}:${task.status}@${task.assignedNode}`).join(', ');
      console.log(`[OrbitDB][${this.nodeId}] CRDT UPDATE APPLIED${summary ? ` -> ${summary}` : ''}`);
    });
  }

  private printStartupBanner(dataDirectory: string): void {
    console.log(`[OrbitDB][${this.nodeId}] Local replica ready.`);
    console.log(`[OrbitDB][${this.nodeId}] Peer ID: ${this.peerId}`);
    console.log(`[OrbitDB][${this.nodeId}] Database address: ${this.databaseAddress}`);
    console.log(`[OrbitDB][${this.nodeId}] Persistent data: ${dataDirectory}`);
    for (const address of this.listenMultiaddresses) {
      console.log(`[OrbitDB][${this.nodeId}] Share this peer multiaddress: ${address}`);
    }
  }
}

let sharedStorePromise: Promise<OrbitDbWorkflowStore> | undefined;

export function getOrbitDbWorkflowStore(): Promise<OrbitDbWorkflowStore> {
  sharedStorePromise ??= OrbitDbWorkflowStore.create(orbitDbOptionsFromEnvironment());
  return sharedStorePromise;
}

export async function closeOrbitDbWorkflowStore(): Promise<void> {
  if (!sharedStorePromise) {
    return;
  }

  const store = await sharedStorePromise;
  sharedStorePromise = undefined;
  await store.close();
}

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { getOrbitDbWorkflowStore } from '../orbitdb/client';
import {
  salSchema,
  uteSchema,
  workflowStateSchema,
  type WorkflowState,
} from '../orbitdb/workflow-state';

const HEARTBEAT_INTERVAL_MS = 2_000;

function localNodeId(): string {
  const nodeId = process.env.NODE_ID?.trim();
  if (!nodeId) {
    throw new Error('NODE_ID is required to run the kill-switch workflow.');
  }
  return nodeId;
}

function demoPauseMs(): number {
  const value = Number(process.env.KILL_SWITCH_PAUSE_AFTER_SAL_MS ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function assertOwnership(task: WorkflowState, nodeId: string): void {
  if (task.assignedNode !== nodeId) {
    throw new Error(
      `[Mastra][${nodeId}] Refusing to write task ${task.taskId}; OrbitDB assigns it to ${task.assignedNode}.`,
    );
  }
}

async function loadReplicatedState(injected: WorkflowState): Promise<WorkflowState> {
  const store = await getOrbitDbWorkflowStore();
  const persisted = await store.getTask(injected.taskId);

  if (persisted) {
    return persisted;
  }

  console.log(`[OrbitDB][${localNodeId()}] Seeding missing task ${injected.taskId} from workflow input.`);
  return store.putTask(workflowStateSchema.parse(injected));
}

async function heartbeatWhile<T>(taskId: string, action: () => Promise<T>): Promise<T> {
  const nodeId = localNodeId();
  const store = await getOrbitDbWorkflowStore();
  let heartbeatQueue = Promise.resolve();

  const heartbeat = (): void => {
    heartbeatQueue = heartbeatQueue
      .then(async () => {
        const updated = await store.touchHeartbeat(taskId, nodeId);
        if (updated) {
          console.log(`[Heartbeat][${nodeId}] task=${taskId} timestamp=${updated.lastHeartbeat}`);
        } else {
          console.warn(`[Heartbeat][${nodeId}] task=${taskId} is no longer owned locally.`);
        }
      })
      .catch(error => {
        console.error(`[Heartbeat][${nodeId}] Unable to persist heartbeat for task=${taskId}.`, error);
      });
  };

  heartbeat();
  const timer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

  try {
    return await action();
  } finally {
    clearInterval(timer);
    await heartbeatQueue;
  }
}

async function persistOwnedUpdate(
  taskId: string,
  update: (current: WorkflowState) => WorkflowState,
): Promise<WorkflowState> {
  const nodeId = localNodeId();
  const store = await getOrbitDbWorkflowStore();
  const persisted = await store.updateTask(taskId, current => {
    assertOwnership(current, nodeId);
    return update(current);
  });

  if (!persisted) {
    throw new Error(`[Mastra][${nodeId}] Failed to persist task ${taskId}.`);
  }

  return persisted;
}

const extractSAL = createStep({
  id: 'extract-sal',
  description: 'Extract Size, Activity, and Location and checkpoint them to OrbitDB.',
  inputSchema: workflowStateSchema,
  outputSchema: workflowStateSchema,
  stateSchema: workflowStateSchema,
  execute: async ({ inputData, state, setState, mastra }) => {
    const injected = workflowStateSchema.parse({ ...inputData, ...state });
    const current = await loadReplicatedState(injected);

    if (current.extractedSAL) {
      console.log(
        `[Mastra][${localNodeId()}] Skipping Step 1 (extractSAL): SAL data already exists in replicated memory.`,
      );
      await setState(current);
      return current;
    }

    const nodeId = localNodeId();
    assertOwnership(current, nodeId);
    console.log(`[Mastra][${nodeId}] STEP 1 START: extracting Size, Activity, Location with local Ollama.`);

    const agent = mastra?.getAgent('killSwitchSitrepAgent');
    if (!agent) {
      throw new Error('Registered killSwitchSitrepAgent was not available to the workflow.');
    }

    const response = await heartbeatWhile(current.taskId, () =>
      agent.generate(
        `DUMMY SAL EXTRACTION PROMPT - replace before operational use. Extract Size, Activity, and Location from only the transcript. Preserve reported counts and grid details. Use "unknown" only when a field is absent.\n\nRaw transcript:\n${current.rawTranscript}`,
        {
          structuredOutput: {
            schema: salSchema,
            jsonPromptInjection: true,
          },
        },
      ),
    );
    const extractedSAL = salSchema.parse(response.object);
    const persisted = await persistOwnedUpdate(current.taskId, latest => ({
      ...latest,
      status: 'in_progress',
      extractedSAL,
      lastHeartbeat: Date.now(),
    }));
    await setState(persisted);

    console.log(`[Mastra][${nodeId}] STEP 1 COMPLETE. SAL checkpoint committed to local OrbitDB.`);
    console.log(`[OrbitDB][${nodeId}] SAL=${JSON.stringify(extractedSAL)}`);

    const pauseMs = demoPauseMs();
    if (pauseMs > 0) {
      console.log('============================================================');
      console.log(`[DEMO][${nodeId}] CHECKPOINT REPLICATED. KILL NODE ALPHA NOW.`);
      console.log(`[DEMO][${nodeId}] Holding before Step 2 for ${pauseMs}ms while heartbeat remains active.`);
      console.log('============================================================');
      await heartbeatWhile(current.taskId, () => new Promise(resolve => setTimeout(resolve, pauseMs)));
      return (await loadReplicatedState(persisted));
    }

    return persisted;
  },
});

const extractUTE = createStep({
  id: 'extract-ute',
  description: 'Extract Unit, Time, and Equipment and checkpoint them to OrbitDB.',
  inputSchema: workflowStateSchema,
  outputSchema: workflowStateSchema,
  stateSchema: workflowStateSchema,
  execute: async ({ inputData, state, setState, mastra }) => {
    const injected = workflowStateSchema.parse({ ...inputData, ...state });
    const current = await loadReplicatedState(injected);

    if (current.extractedUTE) {
      console.log(
        `[Mastra][${localNodeId()}] Skipping Step 2 (extractUTE): UTE data already exists in replicated memory.`,
      );
      await setState(current);
      return current;
    }

    const nodeId = localNodeId();
    assertOwnership(current, nodeId);
    console.log(`[Mastra][${nodeId}] STEP 2 START: extracting Unit, Time, Equipment with local Ollama.`);

    const agent = mastra?.getAgent('killSwitchSitrepAgent');
    if (!agent) {
      throw new Error('Registered killSwitchSitrepAgent was not available to the workflow.');
    }

    const response = await heartbeatWhile(current.taskId, () =>
      agent.generate(
        `DUMMY UTE EXTRACTION PROMPT - replace before operational use. Extract Unit, Time, and Equipment from only the transcript. Include all reported markings, vehicles, weapons, and communications equipment. Use "unknown" only when a field is absent.\n\nRaw transcript:\n${current.rawTranscript}`,
        {
          structuredOutput: {
            schema: uteSchema,
            jsonPromptInjection: true,
          },
        },
      ),
    );
    const extractedUTE = uteSchema.parse(response.object);
    const persisted = await persistOwnedUpdate(current.taskId, latest => ({
      ...latest,
      status: 'in_progress',
      extractedUTE,
      lastHeartbeat: Date.now(),
    }));
    await setState(persisted);

    console.log(`[Mastra][${nodeId}] STEP 2 COMPLETE. UTE checkpoint committed to local OrbitDB.`);
    console.log(`[OrbitDB][${nodeId}] UTE=${JSON.stringify(extractedUTE)}`);
    return persisted;
  },
});

const draftSitrep = createStep({
  id: 'draft-sitrep',
  description: 'Draft the final SITREP and mark the replicated task complete.',
  inputSchema: workflowStateSchema,
  outputSchema: workflowStateSchema,
  stateSchema: workflowStateSchema,
  execute: async ({ inputData, state, setState, mastra }) => {
    const injected = workflowStateSchema.parse({ ...inputData, ...state });
    const current = await loadReplicatedState(injected);

    if (current.finalSitrep && current.status === 'completed') {
      console.log(
        `[Mastra][${localNodeId()}] Skipping Step 3 (draftSitrep): final SITREP already exists and task is completed.`,
      );
      await setState(current);
      return current;
    }

    const nodeId = localNodeId();
    assertOwnership(current, nodeId);
    if (!current.extractedSAL || !current.extractedUTE) {
      throw new Error(`Task ${current.taskId} cannot draft a SITREP until both SAL and UTE are present.`);
    }

    console.log(`[Mastra][${nodeId}] STEP 3 START: drafting formal SITREP with local Ollama.`);
    const agent = mastra?.getAgent('killSwitchSitrepAgent');
    if (!agent) {
      throw new Error('Registered killSwitchSitrepAgent was not available to the workflow.');
    }

    const response = await heartbeatWhile(current.taskId, () =>
      agent.generate(
        `DUMMY SITREP DRAFTING PROMPT - replace before operational use.\n\nSAL:\n${JSON.stringify(
          current.extractedSAL,
          null,
          2,
        )}\n\nUTE:\n${JSON.stringify(current.extractedUTE, null, 2)}`,
      ),
    );
    const finalSitrep = response.text.trim();
    if (!finalSitrep) {
      throw new Error('The local Ollama model returned an empty SITREP.');
    }

    const persisted = await persistOwnedUpdate(current.taskId, latest => ({
      ...latest,
      status: 'completed',
      finalSitrep,
      lastHeartbeat: Date.now(),
    }));
    await setState(persisted);

    console.log(`[Mastra][${nodeId}] STEP 3 COMPLETE. Task marked COMPLETED in OrbitDB.`);
    console.log('======================= FINAL SITREP =======================');
    console.log(finalSitrep);
    console.log('============================================================');
    return persisted;
  },
});

export const killSwitchWorkflow = createWorkflow({
  id: 'kill-switch-workflow',
  description: 'Idempotent SALUTE extraction and SITREP drafting with OrbitDB failover checkpoints.',
  inputSchema: workflowStateSchema,
  outputSchema: workflowStateSchema,
  stateSchema: workflowStateSchema,
})
  .then(extractSAL)
  .then(extractUTE)
  .then(draftSitrep)
  .commit();

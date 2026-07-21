import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findFailoverCandidates,
  findLocallyAssignedTasks,
} from '../../src/mastra/scripts/failover-policy';
import {
  createWorkflowState,
  workflowStateSchema,
  type WorkflowState,
} from '../../src/mastra/orbitdb/workflow-state';

test('workflow state uses taskId as a required stable document key', () => {
  const state = createWorkflowState({
    taskId: 'task-001',
    assignedNode: 'Node Alpha',
    rawTranscript: 'Radio traffic',
    now: 1_000,
  });

  assert.equal(state.taskId, 'task-001');
  assert.equal(state.status, 'pending');
  assert.equal(state.lastHeartbeat, 1_000);
  assert.equal(state.extractedSAL, null);
  assert.equal(state.extractedUTE, null);
  assert.equal(state.finalSitrep, null);
  assert.deepEqual(workflowStateSchema.parse(state), state);
});

test('watcher selects only stale in-progress work owned by another node', () => {
  const base = createWorkflowState({
    taskId: 'stale-task',
    assignedNode: 'Node Alpha',
    rawTranscript: 'Radio traffic',
    now: 1_000,
  });
  const stale: WorkflowState = { ...base, status: 'in_progress' };
  const fresh: WorkflowState = { ...stale, taskId: 'fresh-task', lastHeartbeat: 8_000 };
  const local: WorkflowState = { ...stale, taskId: 'local-task', assignedNode: 'Node Bravo' };
  const complete: WorkflowState = { ...stale, taskId: 'complete-task', status: 'completed' };

  const candidates = findFailoverCandidates(
    [stale, fresh, local, complete],
    'Node Bravo',
    5_000,
    10_000,
  );

  assert.deepEqual(candidates.map(task => task.taskId), ['stale-task']);
});

test('exactly five seconds old is not timed out until it exceeds the threshold', () => {
  const task: WorkflowState = {
    ...createWorkflowState({
      taskId: 'boundary-task',
      assignedNode: 'Node Alpha',
      rawTranscript: 'Radio traffic',
      now: 5_000,
    }),
    status: 'in_progress',
  };

  assert.equal(findFailoverCandidates([task], 'Node Bravo', 5_000, 10_000).length, 0);
  assert.equal(findFailoverCandidates([task], 'Node Bravo', 5_000, 10_001).length, 1);
});

test('watcher immediately runs in-progress work gracefully assigned to the local node', () => {
  const base = createWorkflowState({
    taskId: 'handoff-task',
    assignedNode: 'Node Bravo',
    rawTranscript: 'Radio traffic',
    now: 10_000,
  });
  const assigned: WorkflowState = {
    ...base,
    status: 'in_progress',
    claimedFrom: 'Node Alpha',
  };
  const pending: WorkflowState = { ...assigned, taskId: 'pending-task', status: 'pending' };
  const foreign: WorkflowState = { ...assigned, taskId: 'foreign-task', assignedNode: 'Node Alpha' };
  const complete: WorkflowState = { ...assigned, taskId: 'complete-task', status: 'completed' };

  const runnable = findLocallyAssignedTasks([assigned, pending, foreign, complete], 'Node Bravo');

  assert.deepEqual(runnable.map(task => task.taskId), ['handoff-task']);
});

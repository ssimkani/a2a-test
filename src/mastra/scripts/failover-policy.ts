import type { WorkflowState } from '../orbitdb/workflow-state';

export function findFailoverCandidates(
  tasks: WorkflowState[],
  localNodeId: string,
  timeoutMs: number,
  now = Date.now(),
): WorkflowState[] {
  return tasks.filter(
    task =>
      task.status === 'in_progress' &&
      task.assignedNode !== localNodeId &&
      now - task.lastHeartbeat > timeoutMs,
  );
}

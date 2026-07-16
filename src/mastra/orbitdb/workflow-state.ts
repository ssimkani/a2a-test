import { z } from 'zod';

export const salSchema = z.object({
  size: z.string().min(1).describe('Number and composition of observed personnel or vehicles'),
  activity: z.string().min(1).describe('What the observed element is doing'),
  location: z.string().min(1).describe('Reported grid, route, landmark, or other location'),
});

export const uteSchema = z.object({
  unit: z.string().min(1).describe('Observed unit identity, markings, or affiliation'),
  time: z.string().min(1).describe('Reported observation time and time basis'),
  equipment: z.string().min(1).describe('Observed vehicles, weapons, radios, or other equipment'),
});

export const workflowStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

/**
 * OrbitDB has no GraphQL collection schema. This Zod schema is the executable
 * schema for documents in the `workflow-state` documents database. `taskId` is
 * configured as the OrbitDB document index/primary key in client.ts.
 */
export const workflowStateSchema = z.object({
  taskId: z.string().min(1),
  assignedNode: z.string().min(1),
  status: workflowStatusSchema,
  lastHeartbeat: z.number().int().nonnegative(),
  rawTranscript: z.string().min(1),
  extractedSAL: salSchema.nullable(),
  extractedUTE: uteSchema.nullable(),
  finalSitrep: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  claimedFrom: z.string().nullable(),
});

export type SalExtraction = z.infer<typeof salSchema>;
export type UteExtraction = z.infer<typeof uteSchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;

export function createWorkflowState(input: {
  taskId: string;
  assignedNode: string;
  rawTranscript: string;
  now?: number;
}): WorkflowState {
  const now = input.now ?? Date.now();

  return workflowStateSchema.parse({
    taskId: input.taskId,
    assignedNode: input.assignedNode,
    status: 'pending',
    lastHeartbeat: now,
    rawTranscript: input.rawTranscript,
    extractedSAL: null,
    extractedUTE: null,
    finalSitrep: null,
    revision: 0,
    updatedAt: now,
    claimedFrom: null,
  });
}

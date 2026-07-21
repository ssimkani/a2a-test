import { z } from 'zod';
import { salSchema, uteSchema } from '../orbitdb/workflow-state';

// jsonPromptInjection asks the local model to follow the schema but cannot
// guarantee exact types. Small models commonly represent multi-item fields as
// arrays and occasionally emit numeric counts/times as numbers. Accept those
// provider-facing shapes, then normalize into the strict persisted schema.
const modelScalarSchema = z.union([z.string(), z.number()]);
const modelFieldSchema = z.union([modelScalarSchema, z.array(modelScalarSchema)]).nullable();

export const salModelSchema = z.object({
  size: modelFieldSchema,
  activity: modelFieldSchema,
  location: modelFieldSchema,
});

export const uteModelSchema = z.object({
  unit: modelFieldSchema,
  time: modelFieldSchema,
  equipment: modelFieldSchema,
});

type ModelField = z.infer<typeof modelFieldSchema>;

function normalizeModelField(value: ModelField): string {
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .filter((item): item is string | number => item !== null)
    .map(item => String(item).trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized.join('; ') : 'unknown';
}

export function normalizeSal(value: unknown) {
  const candidate = salModelSchema.parse(value);
  return salSchema.parse({
    size: normalizeModelField(candidate.size),
    activity: normalizeModelField(candidate.activity),
    location: normalizeModelField(candidate.location),
  });
}

export function normalizeUte(value: unknown) {
  const candidate = uteModelSchema.parse(value);
  return uteSchema.parse({
    unit: normalizeModelField(candidate.unit),
    time: normalizeModelField(candidate.time),
    equipment: normalizeModelField(candidate.equipment),
  });
}

import { z } from 'zod';
import { salSchema, uteSchema } from '../orbitdb/workflow-state';

// Native Ollama structured output constrains the response to JSON, but small
// models can still choose reasonable alternate field types. They commonly
// represent multi-item fields as arrays and occasionally emit numeric
// counts/times as numbers. Accept those provider-facing shapes, then normalize
// into the strict persisted schema.
const modelScalarSchema = z.union([z.string(), z.number()]);
const modelFieldSchema = z.union([modelScalarSchema, z.array(modelScalarSchema)]);

export const salModelSchema = z.object({
  size: modelFieldSchema.describe('Reported number and composition of personnel or vehicles'),
  activity: modelFieldSchema.describe('What the observed personnel or vehicles are doing'),
  location: modelFieldSchema.describe('Reported route, grid reference, landmark, or other location'),
});

export const uteModelSchema = z.object({
  unit: modelFieldSchema.describe('Observed unit identity, markings, or affiliation'),
  time: modelFieldSchema.describe('Reported observation time and time basis'),
  equipment: modelFieldSchema.describe('Observed vehicles, weapons, radios, or other equipment'),
});

type ModelField = z.infer<typeof modelFieldSchema>;

function normalizeModelField(value: ModelField): string {
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
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

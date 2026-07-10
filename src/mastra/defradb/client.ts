import { z } from 'zod';

const workspaceEntrySchema = z.object({
  _docID: z.string(),
  path: z.string(),
  parentPath: z.string(),
  name: z.string(),
  entryType: z.enum(['file', 'directory']),
  content: z.string().nullable().optional(),
  encoding: z.enum(['utf-8', 'base64']).nullable().optional(),
  mimeType: z.string().nullable().optional(),
  size: z.number().int(),
  contentHash: z.string().nullable().optional(),
  createdAt: z.string(),
  modifiedAt: z.string(),
  revision: z.number().int(),
  deleted: z.boolean(),
  writerNodeId: z.string(),
});

export type WorkspaceEntry = z.infer<typeof workspaceEntrySchema>;
export type WorkspaceEntryInput = Omit<WorkspaceEntry, '_docID'>;

const ENTRY_FIELDS = `
  _docID
  path
  parentPath
  name
  entryType
  content
  encoding
  mimeType
  size
  contentHash
  createdAt
  modifiedAt
  revision
  deleted
  writerNodeId
`;

function dqlValue(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }

  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(dqlValue).join(', ')}]`;
  }

  return `{ ${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => `${key}: ${dqlValue(item)}`)
    .join(', ')} }`;
}

const graphQlResponseSchema = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
      }),
    )
    .optional(),
});

export interface DefraDbClientOptions {
  baseUrl: string;
  graphqlPath?: string;
  timeoutMs?: number;
}

export class DefraDbClient {
  readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(options: DefraDbClientOptions) {
    this.endpoint = new URL(options.graphqlPath ?? '/api/v0/graphql', options.baseUrl).toString();
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async healthCheck(): Promise<void> {
    await this.request('query { __typename }');
  }

  async getEntry(path: string, includeDeleted = false): Promise<WorkspaceEntry | undefined> {
    const result = await this.request(
      `query { WorkspaceEntry(filter: { path: { _eq: ${dqlValue(path)} } }) { ${ENTRY_FIELDS} } }`,
    );
    const entries = z.array(workspaceEntrySchema).parse(result.WorkspaceEntry ?? []);

    return entries.find(entry => includeDeleted || !entry.deleted);
  }

  async listEntries(includeDeleted = false): Promise<WorkspaceEntry[]> {
    const result = await this.request(`query { WorkspaceEntry { ${ENTRY_FIELDS} } }`);
    const entries = z.array(workspaceEntrySchema).parse(result.WorkspaceEntry ?? []);

    return includeDeleted ? entries : entries.filter(entry => !entry.deleted);
  }

  async createEntry(input: WorkspaceEntryInput): Promise<WorkspaceEntry> {
    const result = await this.request(
      `mutation { create_WorkspaceEntry(input: ${dqlValue(input)}) { ${ENTRY_FIELDS} } }`,
    );

    return z.array(workspaceEntrySchema).min(1).parse(result.create_WorkspaceEntry)[0]!;
  }

  async updateEntry(docId: string, input: Partial<WorkspaceEntryInput>): Promise<WorkspaceEntry> {
    const result = await this.request(
      `mutation { update_WorkspaceEntry(docID: ${dqlValue(docId)}, input: ${dqlValue(input)}) { ${ENTRY_FIELDS} } }`,
    );

    return z.array(workspaceEntrySchema).min(1).parse(result.update_WorkspaceEntry)[0]!;
  }

  private async request(query: string): Promise<Record<string, unknown>> {
    let response: Response;

    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(`Unable to reach DefraDB at ${this.endpoint}`, { cause: error });
    }

    if (!response.ok) {
      throw new Error(`DefraDB request failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const payload = graphQlResponseSchema.parse(await response.json());
    if (payload.errors?.length) {
      throw new Error(`DefraDB query failed: ${payload.errors.map(error => error.message).join('; ')}`);
    }

    if (!payload.data) {
      throw new Error('DefraDB response did not contain data');
    }

    return payload.data;
  }
}

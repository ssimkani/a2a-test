import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const defraDbUrl = process.env.DEFRA_DB_URL ?? 'http://127.0.0.1:9181';
export const graphQlPath = process.env.DEFRA_DB_GRAPHQL_PATH ?? '/api/v0/graphql';
export const nodeId = process.env.DEFRA_DB_NODE_ID ?? 'macbook';
export const endpoint = new URL(graphQlPath, defraDbUrl).toString();

export const entryFields = `
  _docID path parentPath name entryType content encoding mimeType size contentHash
  createdAt modifiedAt revision deleted writerNodeId
`;

export function dqlValue(value) {
  if (value === undefined || value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) return `[${value.map(dqlValue).join(', ')}]`;
  return `{ ${Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => `${key}: ${dqlValue(item)}`).join(', ')} }`;
}

export async function request(query) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(Number(process.env.DEFRA_DB_REQUEST_TIMEOUT_MS ?? 10_000)),
  });
  if (!response.ok) throw new Error(`DefraDB HTTP ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map(error => error.message).join('; '));
  if (!payload.data) throw new Error('DefraDB response did not contain data');
  return payload.data;
}

export async function getEntry(path) {
  const data = await request(`query { WorkspaceEntry(filter: { path: { _eq: ${dqlValue(path)} } }) { ${entryFields} } }`);
  return data.WorkspaceEntry?.[0];
}

export async function listEntries() {
  const data = await request(`query { WorkspaceEntry { ${entryFields} } }`);
  return data.WorkspaceEntry ?? [];
}

export async function upsertEntry(input) {
  const existing = await getEntry(input.path);
  const mutation = existing
    ? `update_WorkspaceEntry(docID: ${dqlValue(existing._docID)}, input: ${dqlValue({ ...input, createdAt: existing.createdAt, revision: existing.revision + 1 })})`
    : `create_WorkspaceEntry(input: ${dqlValue(input)})`;
  await request(`mutation { ${mutation} { _docID path } }`);
}

export function workspaceRecord(path, type, buffer, stat, mimeType) {
  const normalized = path === '.' || path === '' ? '/' : `/${path.split('\\').join('/').replace(/^\/+/, '')}`;
  const isDirectory = type === 'directory';
  const content = isDirectory ? null : buffer;
  return {
    path: normalized,
    parentPath: normalized === '/' ? '/' : posix.dirname(normalized),
    name: normalized === '/' ? '' : posix.basename(normalized),
    entryType: type,
    content: isDirectory ? null : content.toString('base64'),
    encoding: isDirectory ? null : 'base64',
    mimeType: isDirectory ? null : mimeType,
    size: isDirectory ? 0 : content.byteLength,
    contentHash: isDirectory ? null : createHash('sha256').update(content).digest('hex'),
    createdAt: stat.birthtime.toISOString(),
    modifiedAt: stat.mtime.toISOString(),
    revision: 1,
    deleted: false,
    writerNodeId: nodeId,
  };
}

import { LocalFilesystem, Workspace } from '@mastra/core/workspace';
import { DefraDbFilesystem } from './defradb/filesystem';

const workspaceBackend = process.env.WORKSPACE_BACKEND ?? 'local';

function createWorkspaceFilesystem() {
  if (workspaceBackend === 'local') {
    return new LocalFilesystem({
      id: 'vm-agent-filesystem',
      basePath: './workspace',
      contained: true,
    });
  }

  if (workspaceBackend !== 'defradb') {
    throw new Error(`Unsupported WORKSPACE_BACKEND "${workspaceBackend}"; expected "local" or "defradb"`);
  }

  return new DefraDbFilesystem({
    id: 'vm-agent-defradb-filesystem',
    baseUrl: process.env.DEFRA_DB_URL ?? 'http://127.0.0.1:9181',
    graphqlPath: process.env.DEFRA_DB_GRAPHQL_PATH ?? '/api/v0/graphql',
    nodeId: process.env.DEFRA_DB_NODE_ID ?? 'vm',
    timeoutMs: Number(process.env.DEFRA_DB_REQUEST_TIMEOUT_MS ?? 10_000),
    maxFileBytes: Number(process.env.DEFRA_DB_MAX_FILE_BYTES ?? 10 * 1024 * 1024),
  });
}

export const vmAgentWorkspace = new Workspace({
  id: 'vm-agent-workspace',
  name: 'VM A2A Agent Workspace',
  filesystem: createWorkspaceFilesystem(),
});

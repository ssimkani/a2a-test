import { LocalFilesystem, Workspace, WORKSPACE_TOOLS } from '@mastra/core/workspace';

export const windowsAgentWorkspace = new Workspace({
  id: 'windows-agent-workspace',
  name: 'Windows A2A Agent Workspace',
  filesystem: new LocalFilesystem({
    id: 'windows-agent-filesystem',
    basePath: './workspace',
    contained: true,
  }),
  tools: {
    enabled: false,
    [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: { enabled: true, name: 'read_file' },
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: { enabled: true, name: 'save_file' },
    [WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES]: { enabled: true, name: 'list_files' },
  },
});

import { LocalFilesystem, Workspace } from '@mastra/core/workspace';

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
  },
});

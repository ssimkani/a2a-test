import { LocalFilesystem, Workspace } from '@mastra/core/workspace';

export const a2aAgentWorkspace = new Workspace({
  id: 'a2a-agent-workspace',
  name: 'MacBook A2A Agent Workspace',
  filesystem: new LocalFilesystem({
    id: 'a2a-agent-filesystem',
    basePath: './workspace',
    contained: true,
  }),
});

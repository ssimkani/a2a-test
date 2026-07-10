import { LocalFilesystem, Workspace } from '@mastra/core/workspace';

export const vmAgentWorkspace = new Workspace({
  id: 'vm-agent-workspace',
  name: 'VM A2A Agent Workspace',
  filesystem: new LocalFilesystem({
    id: 'vm-agent-filesystem',
    basePath: './workspace',
    contained: true,
  }),
});

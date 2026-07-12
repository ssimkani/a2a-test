import { createPeerA2ATool } from './peer-a2a-tool';
import { a2aAgentWorkspace } from '../workspace';

export const sendToWindowsAgentTool = createPeerA2ATool({
  id: 'send-to-windows-agent',
  description:
    'Send text, structured JSON, and selected workspace files to the agent on the peer-connected Windows computer for analysis, critique, or collaboration.',
  sourceAgentId: 'a2a-agent',
  targetAgentId: 'windows-agent',
  baseUrlEnv: 'WINDOWS_MASTRA_BASE_URL',
  agentIdEnv: 'WINDOWS_A2A_AGENT_ID',
  apiPrefixEnv: 'WINDOWS_MASTRA_API_PREFIX',
  tokenEnv: 'WINDOWS_A2A_TOKEN',
  workspace: a2aAgentWorkspace,
});

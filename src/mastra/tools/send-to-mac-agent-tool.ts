import { createPeerA2ATool } from './peer-a2a-tool';
import { vmAgentWorkspace } from '../workspace';

export const sendToMacAgentTool = createPeerA2ATool({
  id: 'send-to-mac-agent',
  description:
    'Send text, structured JSON, and selected workspace files to the independent MacBook agent for analysis, critique, or collaboration.',
  sourceAgentId: 'vm-agent',
  targetAgentId: 'a2a-agent',
  baseUrlEnv: 'MAC_MASTRA_BASE_URL',
  agentIdEnv: 'MAC_A2A_AGENT_ID',
  apiPrefixEnv: 'MAC_MASTRA_API_PREFIX',
  tokenEnv: 'MAC_A2A_TOKEN',
  workspace: vmAgentWorkspace,
});

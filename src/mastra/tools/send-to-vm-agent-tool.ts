import { createPeerA2ATool } from './peer-a2a-tool';

export const sendToVmAgentTool = createPeerA2ATool({
  id: 'send-to-vm-agent',
  description:
    'Send text, structured JSON, and selected workspace files to the independent VM agent for analysis, critique, or collaboration.',
  sourceAgentId: 'a2a-agent',
  targetAgentId: 'vm-agent',
  baseUrlEnv: 'VM_MASTRA_BASE_URL',
  agentIdEnv: 'VM_A2A_AGENT_ID',
  apiPrefixEnv: 'VM_MASTRA_API_PREFIX',
  tokenEnv: 'VM_A2A_TOKEN',
});

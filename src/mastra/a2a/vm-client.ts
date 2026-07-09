import { MastraClient } from '@mastra/client-js';

const vmBaseUrl = process.env.VM_MASTRA_BASE_URL;
const vmAgentId = process.env.VM_A2A_AGENT_ID ?? 'vm-agent';
const vmApiPrefix = process.env.VM_MASTRA_API_PREFIX ?? '/api';
const vmA2AToken = process.env.VM_A2A_TOKEN;

if (!vmBaseUrl) {
  throw new Error('VM_MASTRA_BASE_URL is required, for example http://192.168.1.50:4111');
}

export const vmMastraClient = new MastraClient({
  baseUrl: vmBaseUrl,
  apiPrefix: vmApiPrefix,
  retries: 2,
  backoffMs: 250,
  maxBackoffMs: 1_000,
  headers: vmA2AToken
    ? {
        Authorization: `Bearer ${vmA2AToken}`,
      }
    : undefined,
});

export const vmA2A = vmMastraClient.getA2A(vmAgentId);

export const vmA2AConfig = {
  agentId: vmAgentId,
  baseUrl: vmBaseUrl,
  apiPrefix: vmApiPrefix,
};

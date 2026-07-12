import { MastraClient } from '@mastra/client-js';

export function getWindowsA2AClient() {
  const windowsBaseUrl = process.env.WINDOWS_MASTRA_BASE_URL;
  const windowsAgentId = process.env.WINDOWS_A2A_AGENT_ID ?? 'windows-agent';
  const windowsApiPrefix = process.env.WINDOWS_MASTRA_API_PREFIX ?? '/api';
  const windowsA2AToken = process.env.WINDOWS_A2A_TOKEN;

  if (!windowsBaseUrl) {
    throw new Error('WINDOWS_MASTRA_BASE_URL is required, for example http://192.168.21.175:4111');
  }

  const windowsMastraClient = new MastraClient({
    baseUrl: windowsBaseUrl,
    apiPrefix: windowsApiPrefix,
    retries: 2,
    backoffMs: 250,
    maxBackoffMs: 1_000,
    headers: windowsA2AToken
      ? {
          Authorization: `Bearer ${windowsA2AToken}`,
        }
      : undefined,
  });

  return {
    windowsMastraClient,
    windowsA2A: windowsMastraClient.getA2A(windowsAgentId),
    windowsA2AConfig: {
      agentId: windowsAgentId,
      baseUrl: windowsBaseUrl,
      apiPrefix: windowsApiPrefix,
    },
  };
}

export const windowsA2AConfig = {
  agentId: process.env.WINDOWS_A2A_AGENT_ID ?? 'windows-agent',
  baseUrl: process.env.WINDOWS_MASTRA_BASE_URL,
  apiPrefix: process.env.WINDOWS_MASTRA_API_PREFIX ?? '/api',
};

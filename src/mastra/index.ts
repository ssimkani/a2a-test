
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { a2aAgent } from './agents/a2a-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';
import { sendToWindowsAgentTool } from './tools/send-to-windows-agent-tool';
import { killSwitchWorkflow } from './workflows/kill-switch-workflow';
import { killSwitchSitrepAgent } from './agents/kill-switch-sitrep-agent';

const a2aApiToken = process.env.A2A_API_TOKEN;

export const mastra = new Mastra({
  // OrbitDB persists through Level-backed packages that Mastra should install
  // beside the server rather than inline into its JavaScript bundle. Keep the
  // Ollama provider bundled because the current app also carries older Mastra
  // dependencies with a different optional Zod peer range.
  bundler: {
    externals: [
      '@orbitdb/core',
      'helia',
      '@helia/bitswap',
      '@helia/libp2p',
      'blockstore-level',
      'datastore-level',
      '@libp2p/gossipsub',
      '@chainsafe/libp2p-noise',
      '@chainsafe/libp2p-yamux',
      '@libp2p/identify',
      '@libp2p/tcp',
      '@ipld/dag-cbor',
      '@multiformats/multiaddr',
      '@mastra/libsql',
    ],
  },
  storage: new LibSQLStore({
    id: 'a2a-test-mastra-storage',
    url: process.env.MASTRA_STORAGE_URL ?? 'file:./mastra.db',
  }),
  workflows: { weatherWorkflow, killSwitchWorkflow },
  agents: { weatherAgent, a2aAgent, killSwitchSitrepAgent },
  tools: { sendToWindowsAgentTool },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  server: {
    host: process.env.MASTRA_HOST ?? '0.0.0.0',
    studioHost: process.env.MASTRA_STUDIO_HOST ?? 'localhost',
    studioProtocol: 'http',
    port: Number(process.env.PORT ?? 4111),
    apiPrefix: '/api',
    middleware: a2aApiToken
      ? {
          path: '/api/*',
          handler: async (context, next) => {
            if (context.req.header('Authorization') !== `Bearer ${a2aApiToken}`) {
              return context.json({ error: 'Unauthorized' }, 401);
            }

            await next();
          },
        }
      : undefined,
  },
});

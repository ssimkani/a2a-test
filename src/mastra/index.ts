
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { weatherWorkflow } from './workflows/weather-workflow';
import { a2aConversationWorkflow } from './workflows/a2a-conversation-workflow';
import { weatherAgent } from './agents/weather-agent';
import { a2aAgent } from './agents/a2a-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';

const a2aApiToken = process.env.A2A_API_TOKEN;

export const mastra = new Mastra({
  workflows: { weatherWorkflow, a2aConversationWorkflow },
  agents: { weatherAgent, a2aAgent },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: "mastra-storage",
      url: "file:./mastra.db",
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    }
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
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

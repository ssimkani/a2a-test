
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { a2aAgent } from './agents/a2a-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';
import { sendToWindowsAgentTool } from './tools/send-to-windows-agent-tool';

const a2aApiToken = process.env.A2A_API_TOKEN;

export const mastra = new Mastra({
  bundler: { externals: false },
  workflows: { weatherWorkflow },
  agents: { weatherAgent, a2aAgent },
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

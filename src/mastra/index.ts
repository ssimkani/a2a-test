
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { vmAgent } from './agents/vm-agent';
import { sendToMacAgentTool } from './tools/send-to-mac-agent-tool';

const a2aApiToken = process.env.A2A_API_TOKEN;

export const mastra = new Mastra({
  agents: { vmAgent },
  tools: { sendToMacAgentTool },
  storage: new LibSQLStore({
    id: 'vm-mastra-storage',
    url: 'file:./mastra.db',
  }),
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

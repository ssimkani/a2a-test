import { MastraClient } from '@mastra/client-js';

const baseUrl = process.env.VM_MASTRA_BASE_URL;
const agentId = process.env.VM_A2A_AGENT_ID ?? 'vm-agent';
const apiPrefix = process.env.VM_MASTRA_API_PREFIX ?? '/api';
const token = process.env.VM_A2A_TOKEN;
const prompt =
  process.argv.slice(2).join(' ') ||
  'Hello from my local machine. Please stream back a short response.';

if (!baseUrl) {
  console.error('Missing VM_MASTRA_BASE_URL. Example: VM_MASTRA_BASE_URL=http://192.168.1.50:4111');
  process.exit(1);
}

const client = new MastraClient({
  baseUrl,
  apiPrefix,
  retries: 2,
  backoffMs: 250,
  maxBackoffMs: 1_000,
  headers: token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : undefined,
});

const a2a = client.getA2A(agentId);

console.log(`Connecting to ${baseUrl}${apiPrefix} as A2A agent "${agentId}"`);

const card = await a2a.getAgentCard();
console.log('Agent card:', {
  name: card.name,
  url: card.url,
  capabilities: card.capabilities,
});

const stream = a2a.sendMessageStream({
  message: {
    kind: 'message',
    role: 'user',
    messageId: crypto.randomUUID(),
    parts: [{ kind: 'text', text: prompt }],
  },
});

let lastTaskId;

for await (const event of stream) {
  if (event.kind === 'task' || event.kind === 'status-update' || event.kind === 'artifact-update') {
    lastTaskId = event.taskId ?? event.id ?? lastTaskId;
  }

  console.log(JSON.stringify(event, null, 2));
}

if (lastTaskId) {
  console.log(`Last task id: ${lastTaskId}`);
}

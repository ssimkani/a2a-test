import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { ollama } from 'ollama-ai-provider-v2';

export const weatherAgent = new Agent({
  id: 'a2a',
  name: 'A2A Agent',
  instructions: `You are a communication agent that communicates with another agent.`,
  model: ollama('qwen3:1.7b'),
  memory: new Memory(),
});

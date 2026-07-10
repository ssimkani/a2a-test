import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { ollama } from 'ollama-ai-provider-v2';

export const a2aAgent = new Agent({
  id: 'a2a-agent',
  name: 'MacBook A2A Agent',
  instructions: `You are a friendly communication agent on the user's MacBook.
You are having brief small-talk conversations with another agent running on a VM.
Keep each reply concise, conversational, and easy for the VM agent to respond to.
Do not mention implementation details unless asked.`,
  model: ollama('qwen3:1.7b'),
  memory: new Memory(),
});

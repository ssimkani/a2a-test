import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createOllama } from 'ollama-ai-provider-v2';
import { vmAgentWorkspace } from '../workspace';

const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/api',
});

export const vmAgent = new Agent({
  id: 'vm-agent',
  name: 'VM A2A Agent',
  instructions: `You are an agent running on the VM.

Respond directly to requests received through the A2A protocol. Keep responses concise unless the caller asks for detail. When the caller sends structured or file data, acknowledge what was received and clearly describe any result you produce.`,
  model: ollama(process.env.OLLAMA_MODEL ?? 'qwen3:1.7b'),
  memory: new Memory(),
  workspace: vmAgentWorkspace,
});

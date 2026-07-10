import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
// import { createOllama } from 'ollama-ai-provider-v2';
import { sendToMacAgentTool } from '../tools/send-to-mac-agent-tool';
import { vmAgentWorkspace } from '../workspace';

// const ollama = createOllama({
//   baseURL: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/api',
// });

export const vmAgent = new Agent({
  id: 'vm-agent',
  name: 'VM A2A Agent',
  instructions: `You are an agent running on the VM.

Respond directly to requests received through the A2A protocol. Keep responses concise unless the caller asks for detail. When the caller sends structured or file data, acknowledge what was received and clearly describe any result you produce.
When a peer message includes a peer-envelope, read its JSON payload and embedded file content directly. Sender workspace paths are provenance, not local paths. Save a local copy beneath a2a/inbox/<collaboration-id>/ only when it is useful for your work.
Use sendToMacAgentTool when communicating or collaborating with the independent MacBook agent. You may send text, structured JSON, and relevant workspace files. Reuse the collaboration ID for follow-up questions, increment the round for each call, and never exceed five rounds. Do not call the peer merely to acknowledge a peer message.`,
  // model: ollama(process.env.OLLAMA_MODEL ?? 'qwen3:1.7b'),
  model: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
  memory: new Memory(),
  tools: { sendToMacAgentTool },
  workspace: vmAgentWorkspace,
});

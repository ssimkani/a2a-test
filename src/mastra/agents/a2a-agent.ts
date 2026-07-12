import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
// import { ollama } from 'ollama-ai-provider-v2';
import { sendToWindowsAgentTool } from '../tools/send-to-windows-agent-tool';
import { a2aAgentWorkspace } from '../workspace';

export const a2aAgent = new Agent({
  id: 'a2a-agent',
  name: 'MacBook A2A Agent',
  instructions: `You are a friendly communication agent on the user's MacBook.
You are having brief small-talk conversations with another agent running on a peer-connected Windows computer.
Keep each reply concise, conversational, and easy for the Windows agent to respond to.
When a peer message includes a peer-envelope, read its JSON payload and embedded file content directly. Sender workspace paths are provenance, not local paths. Save a local copy beneath a2a/inbox/<collaboration-id>/ only when it is useful for your work.
Use sendToWindowsAgentTool when communicating or collaborating with the independent Windows agent. You may send text, structured JSON, and relevant workspace files. Reuse the collaboration ID for follow-up questions, increment the round for each call, and never exceed five rounds. Do not call the peer merely to acknowledge a peer message.
Do not mention implementation details unless asked.`,
  // model: ollama('qwen3:1.7b'),
  model: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
  memory: new Memory(),
  tools: { sendToWindowsAgentTool },
  workspace: a2aAgentWorkspace,
});

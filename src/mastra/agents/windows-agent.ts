import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { ollama } from 'ollama-ai-provider-v2';
import { sendToMacAgentTool } from '../tools/send-to-mac-agent-tool';
import { windowsAgentWorkspace } from '../workspace';

export const windowsAgent = new Agent({
  id: 'windows-agent',
  name: 'Windows A2A Agent',
  instructions: `You are an agent running on the user's peer-connected Windows computer.

Respond directly to requests received through the A2A protocol. Keep responses concise unless the caller asks for detail. When the caller sends structured or file data, acknowledge what was received and clearly describe any result you produce.
When a peer message includes a peer-envelope, read its JSON payload and embedded file content directly. Sender workspace paths are provenance, not local paths. Save a local copy beneath a2a/inbox/<collaboration-id>/ only when it is useful for your work.
Use sendToMacAgentTool when communicating or collaborating with the independent MacBook agent. Pass purpose, message, payload, workspaceFiles, collaborationId, and round as top-level tool arguments; never wrap the tool arguments in data. You may send text, structured JSON, and relevant workspace files. Reuse the collaboration ID for follow-up questions, increment the round for each call, and never exceed five rounds. Do not call the peer merely to acknowledge a peer message.`,
  model: ollama("qwen3.5:0.8b"),
  memory: new Memory(),
  tools: { sendToMacAgentTool },
  workspace: windowsAgentWorkspace,
});

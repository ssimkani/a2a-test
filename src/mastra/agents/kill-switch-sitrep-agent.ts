import { Agent } from '@mastra/core/agent';
import { createOllama } from 'ollama-ai-provider-v2';

const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434/api',
});

export const killSwitchSitrepAgent = new Agent({
  id: 'kill-switch-sitrep-agent',
  name: 'Kill Switch SITREP Agent',
  instructions: `You transform a raw radio transcript into structured SALUTE fields and a concise formal SITREP.

This is demonstration scaffolding. The operator will replace these instructions with the approved mission prompt.
Return only the requested fields. Do not invent details; use "unknown" when the transcript does not provide a value.`,
  model: ollama(process.env.KILL_SWITCH_OLLAMA_MODEL?.trim() || 'qwen3.5:2b'),
  defaultOptions: {
    modelSettings: {
      temperature: 0,
      maxOutputTokens: 2048,
    },
  },
});

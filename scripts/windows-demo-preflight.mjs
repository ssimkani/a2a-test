import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const agent = await readFile(resolve('src/mastra/agents/windows-agent.ts'), 'utf8');
const workspace = await readFile(resolve('src/mastra/workspace.ts'), 'utf8');
const required = ['TRANSFER_AND_ANALYZE', 'CRITIQUE_AND_REVISE', 'VERIFY_SAVED_FILE', 'save_file', 'read_file', 'FILE_VERIFIED'];
for (const value of required) {
  if (!agent.includes(value) && !workspace.includes(value)) throw new Error(`Missing Windows demo instruction: ${value}`);
}
if (/DefraDb|WORKSPACE_BACKEND/.test(workspace)) throw new Error('Windows workspace is not local-only');
console.log(JSON.stringify({ ready: true, model: 'oamazonasgabriel/lfm2.5-230m:bf16-8gbRAM', required }, null, 2));

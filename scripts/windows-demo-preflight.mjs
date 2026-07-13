import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const agent = await readFile(resolve('src/mastra/agents/windows-agent.ts'), 'utf8');
const workspace = await readFile(resolve('src/mastra/workspace.ts'), 'utf8');
const processor = await readFile(resolve('src/mastra/processors/a2a-file-persistence-processor.ts'), 'utf8');
const required = ['TRANSFER_AND_ANALYZE', 'CRITIQUE_AND_REVISE', 'VERIFY_SAVED_FILE', 'TRANSPORT_PERSISTENCE_RECEIPT', 'TRANSPORT_FILE_VERIFIED', 'FILE_VERIFIED'];
for (const value of required) {
  if (!agent.includes(value) && !processor.includes(value)) throw new Error(`Missing Windows demo instruction: ${value}`);
}
if (/DefraDb|WORKSPACE_BACKEND/.test(workspace)) throw new Error('Windows workspace is not local-only');
console.log(JSON.stringify({ ready: true, modelToolsExposed: false, persistence: 'A2A input processor', model: 'lfm2.5-thinking', required }, null, 2));

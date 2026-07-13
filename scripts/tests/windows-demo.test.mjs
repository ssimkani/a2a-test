import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');

test('Windows thinking agent uses deterministic transport and literal stage instructions', async () => {
  const agent = await readFile(resolve(root, 'src/mastra/agents/windows-agent.ts'), 'utf8');
  assert.match(agent, /ollama\(process\.env\.OLLAMA_MODEL \?\? 'lfm2\.5-thinking'\)/);
  assert.doesNotMatch(agent, /ollama\.completion/);
  for (const value of ['TRANSFER_AND_ANALYZE', 'TRANSPORT_PERSISTENCE_RECEIPT', 'CRITIQUE_AND_REVISE', 'TRANSPORT_SAVED_DATASET', 'VERIFY_SAVED_FILE', 'FILE_VERIFIED']) {
    assert.match(agent, new RegExp(value));
  }
  assert.doesNotMatch(agent, /tools:/);
});

test('Windows workspace is local-only and leaves protocol persistence to the input processor', async () => {
  const workspace = await readFile(resolve(root, 'src/mastra/workspace.ts'), 'utf8');
  assert.doesNotMatch(workspace, /DefraDb|WORKSPACE_BACKEND/);
  assert.match(workspace, /enabled: false/);
});

test('input processor persists and byte-verifies A2A files before inference', async () => {
  const processor = await readFile(resolve(root, 'src/mastra/processors/a2a-file-persistence-processor.ts'), 'utf8');
  for (const value of ['edge-peer-collaboration/v1', 'received/${envelope.collaborationId}', 'writeFile', 'readFile', 'verified.equals(bytes)', 'TRANSPORT_PERSISTENCE_RECEIPT', 'TRANSPORT_FILE_VERIFIED', 'TRANSPORT_VERIFIED_FACTS', 'FINAL LINE MUST BE EXACTLY']) {
    assert.ok(processor.includes(value), `missing ${value}`);
  }
});

test('package exposes tests, preflight, and independent workspace verification without DefraDB commands', async () => {
  const packageJson = await readFile(resolve(root, 'package.json'), 'utf8');
  assert.match(packageJson, /demo:dry-run/);
  assert.match(packageJson, /demo:verify-workspace/);
  assert.doesNotMatch(packageJson, /defradb:/i);
});

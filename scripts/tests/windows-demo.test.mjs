import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');

test('Windows 230M agent is tool-less and has literal transport, analyze, and marker instructions', async () => {
  const agent = await readFile(resolve(root, 'src/mastra/agents/windows-agent.ts'), 'utf8');
  assert.match(agent, /oamazonasgabriel\/lfm2\.5-230m:bf16-8gbRAM/);
  for (const value of ['TRANSFER_AND_ANALYZE', 'TRANSPORT_PERSISTENCE_RECEIPT', 'CRITIQUE_AND_REVISE', 'TRANSPORT_SAVED_DATASET', 'VERIFY_SAVED_FILE', 'FILE_VERIFIED']) {
    assert.match(agent, new RegExp(value));
  }
  assert.doesNotMatch(agent, /tools:/);
});

test('Windows workspace is local-only and exposes no tools to the unsupported model', async () => {
  const workspace = await readFile(resolve(root, 'src/mastra/workspace.ts'), 'utf8');
  assert.doesNotMatch(workspace, /DefraDb|WORKSPACE_BACKEND/);
  assert.match(workspace, /enabled: false/);
});

test('input processor persists and byte-verifies A2A files before inference', async () => {
  const processor = await readFile(resolve(root, 'src/mastra/processors/a2a-file-persistence-processor.ts'), 'utf8');
  for (const value of ['edge-peer-collaboration/v1', 'received/${envelope.collaborationId}', 'writeFile', 'readFile', 'verified.equals(bytes)', 'TRANSPORT_PERSISTENCE_RECEIPT', 'TRANSPORT_FILE_VERIFIED']) {
    assert.ok(processor.includes(value), `missing ${value}`);
  }
});

test('package exposes tests, preflight, and independent workspace verification without DefraDB commands', async () => {
  const packageJson = await readFile(resolve(root, 'package.json'), 'utf8');
  assert.match(packageJson, /demo:dry-run/);
  assert.match(packageJson, /demo:verify-workspace/);
  assert.doesNotMatch(packageJson, /defradb:/i);
});

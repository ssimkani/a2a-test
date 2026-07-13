import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');

test('Windows 230M agent has literal save, read, analyze, and marker instructions', async () => {
  const agent = await readFile(resolve(root, 'src/mastra/agents/windows-agent.ts'), 'utf8');
  assert.match(agent, /oamazonasgabriel\/lfm2\.5-230m:bf16-8gbRAM/);
  for (const value of ['TRANSFER_AND_ANALYZE', 'save_file', 'read_file', 'CRITIQUE_AND_REVISE', 'VERIFY_SAVED_FILE', 'FILE_VERIFIED']) {
    assert.match(agent, new RegExp(value));
  }
});

test('Windows workspace is local-only with a narrow small-model tool surface', async () => {
  const workspace = await readFile(resolve(root, 'src/mastra/workspace.ts'), 'utf8');
  assert.doesNotMatch(workspace, /DefraDb|WORKSPACE_BACKEND/);
  assert.match(workspace, /name: 'read_file'/);
  assert.match(workspace, /name: 'save_file'/);
  assert.match(workspace, /name: 'list_files'/);
  assert.match(workspace, /enabled: false/);
});

test('peer prompt requires file persistence before analysis', async () => {
  const peerTool = await readFile(resolve(root, 'src/mastra/tools/peer-a2a-tool.ts'), 'utf8');
  for (const value of ['REQUIRED FILE ACTIONS', 'received/${collaborationId}', 'save_file', 'read_file', 'WINDOWS_TRANSFER_ANALYSIS_COMPLETE', 'Never use DefraDB']) {
    assert.ok(peerTool.includes(value), `missing ${value}`);
  }
});

test('package exposes tests, preflight, and independent workspace verification without DefraDB commands', async () => {
  const packageJson = await readFile(resolve(root, 'package.json'), 'utf8');
  assert.match(packageJson, /demo:dry-run/);
  assert.match(packageJson, /demo:verify-workspace/);
  assert.doesNotMatch(packageJson, /defradb:/i);
});

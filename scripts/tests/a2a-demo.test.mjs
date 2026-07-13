import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { REQUIRED_MARKERS, analyzeSalesCsv, assertMarker, buildStagePrompt, findResponse } from '../lib/a2a-demo.mjs';

const root = resolve(import.meta.dirname, '../..');

test('sample dataset has stable expected insights', async () => {
  const csv = await readFile(resolve(root, 'src/mastra/public/workspace/demo/sales-data.csv'), 'utf8');
  const result = analyzeSalesCsv(csv);
  assert.equal(result.rowCount, 4);
  assert.equal(result.totalRevenue, 3600);
  assert.equal(result.highestUnits.product, 'Gamma');
  assert.equal(result.highestRevenue.product, 'Beta');
  assert.equal(result.highestReturnRate.product, 'Delta');
  assert.equal(result.lowestReturnRate.product, 'Gamma');
  assert.equal(result.highestReturnRate.returnRate, 20);
  assert.equal(result.lowestReturnRate.returnRate, 2);
});

test('small-model stage prompt is explicit and marker-bound', () => {
  const prompt = buildStagePrompt({ stage: 'MAC_ANALYSIS_AND_CRITIQUE', collaborationId: 'demo-1', round: 2, dataset: 'x', peerAnalysis: 'y' });
  for (const text of ['MAC_ANALYSIS_AND_CRITIQUE', 'demo-1', 'total revenue', 'highest/lowest return rates', REQUIRED_MARKERS.critique]) {
    assert.match(prompt, new RegExp(text.replace('/', '\\/'), 'i'));
  }
});

test('tool response extraction handles Mastra response wrappers', () => {
  assert.equal(findResponse({ result: { response: 'done' } }), 'done');
  assert.equal(findResponse({ data: { nested: { response: 'nested' } } }), 'nested');
  assert.throws(() => assertMarker('wrong', REQUIRED_MARKERS.transfer, 'test'));
});

test('runtime is local-workspace and demo scripts contain all five stages', async () => {
  const workspace = await readFile(resolve(root, 'src/mastra/workspace.ts'), 'utf8');
  const packageJson = await readFile(resolve(root, 'package.json'), 'utf8');
  const demo = await readFile(resolve(root, 'scripts/a2a-collaboration-demo.mjs'), 'utf8');
  assert.doesNotMatch(workspace, /DefraDb|WORKSPACE_BACKEND/);
  assert.doesNotMatch(packageJson, /defradb:/i);
  for (const stage of ['TRANSFER_AND_ANALYZE', 'MAC_ANALYSIS_AND_CRITIQUE', 'CRITIQUE_AND_REVISE', 'FINAL_CONSENSUS', 'VERIFY_SAVED_FILE']) {
    assert.match(demo, new RegExp(stage));
  }
});

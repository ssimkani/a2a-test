import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeSalesCsv, sha256 } from './lib/a2a-demo.mjs';

const collaborationId = process.argv[2];
if (!collaborationId) {
  console.error('Usage: npm run demo:verify-workspace -- <collaboration-id>');
  process.exit(1);
}
const workspaceRoot = resolve(process.env.LOCAL_WORKSPACE_PATH ?? 'src/mastra/public/workspace');
const receivedPath = resolve(workspaceRoot, 'received', collaborationId, 'sales-data.csv');
const content = await readFile(receivedPath, 'utf8');
const analysis = analyzeSalesCsv(content);
if (analysis.rowCount !== 4 || analysis.totalRevenue !== 3600) {
  throw new Error(`Saved file failed checks: ${JSON.stringify(analysis)}`);
}
console.log(JSON.stringify({ verified: true, receivedPath, sha256: sha256(content), analysis }, null, 2));

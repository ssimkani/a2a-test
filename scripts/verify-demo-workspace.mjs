import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const collaborationId = process.argv[2];
if (!collaborationId) {
  console.error('Usage: npm run demo:verify-workspace -- <collaboration-id>');
  process.exit(1);
}
const root = resolve(process.env.LOCAL_WORKSPACE_PATH ?? 'src/mastra/public/workspace');
const receivedPath = resolve(root, 'received', collaborationId, 'sales-data.csv');
const content = await readFile(receivedPath, 'utf8');
const [header, ...lines] = content.trim().split(/\r?\n/);
if (header !== 'product,units,revenue,returns' || lines.length !== 4) throw new Error('Received CSV shape is invalid');
const rows = lines.map((line) => {
  const [product, units, revenue, returns] = line.split(',');
  return { product, units: Number(units), revenue: Number(revenue), returns: Number(returns) };
});
const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
if (totalRevenue !== 3600) throw new Error(`Expected total revenue 3600, got ${totalRevenue}`);
console.log(JSON.stringify({
  verified: true,
  receivedPath,
  sha256: createHash('sha256').update(content).digest('hex'),
  rowCount: rows.length,
  totalRevenue,
  highestUnits: rows.reduce((best, row) => row.units > best.units ? row : best).product,
  highestRevenue: rows.reduce((best, row) => row.revenue > best.revenue ? row : best).product,
}, null, 2));

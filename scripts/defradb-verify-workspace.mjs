import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { listEntries } from './lib/defradb.mjs';

const root = resolve(process.env.LOCAL_WORKSPACE_PATH ?? 'src/mastra/public/workspace');

async function collectFiles(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) files.push(...await collectFiles(path));
    else files.push(path);
  }
  return files;
}

const remoteByPath = new Map((await listEntries()).filter(entry => !entry.deleted).map(entry => [entry.path, entry]));
const failures = [];
for (const file of await collectFiles(root)) {
  const path = `/${relative(root, file).split('\\').join('/')}`;
  const hash = createHash('sha256').update(await readFile(file)).digest('hex');
  const remote = remoteByPath.get(path);
  if (!remote) failures.push(`${path}: missing from DefraDB`);
  else if (remote.contentHash !== hash) failures.push(`${path}: hash mismatch (${hash} != ${remote.contentHash})`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Every local workspace file has a matching DefraDB content hash.');

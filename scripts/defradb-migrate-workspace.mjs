import { lstat, readFile, readdir } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { upsertEntry, workspaceRecord } from './lib/defradb.mjs';

const root = resolve(process.env.LOCAL_WORKSPACE_PATH ?? 'src/mastra/public/workspace');
const mimeTypes = {
  '.css': 'text/css', '.csv': 'text/csv', '.html': 'text/html', '.json': 'application/json',
  '.jsonl': 'application/x-ndjson', '.md': 'text/markdown', '.mjs': 'text/javascript',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.yaml': 'application/yaml', '.yml': 'application/yaml',
};

async function collect(directory) {
  const paths = [directory];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    paths.push(...(item.isDirectory() ? await collect(path) : [path]));
  }
  return paths;
}

let imported = 0;
for (const absolutePath of await collect(root)) {
  const stat = await lstat(absolutePath);
  const workspacePath = relative(root, absolutePath) || '.';
  const buffer = stat.isDirectory() ? Buffer.alloc(0) : await readFile(absolutePath);
  const mimeType = mimeTypes[extname(absolutePath).toLowerCase()] ?? 'application/octet-stream';
  await upsertEntry(workspaceRecord(workspacePath, stat.isDirectory() ? 'directory' : 'file', buffer, stat, mimeType));
  imported += 1;
  console.log(`Imported ${workspacePath}`);
}

console.log(`Imported ${imported} workspace entries from ${root}.`);

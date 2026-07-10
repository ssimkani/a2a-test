import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { defraDbUrl, endpoint, request } from './lib/defradb.mjs';

const run = promisify(execFile);
const schemaPath = new URL('../src/mastra/defradb/schema.graphql', import.meta.url);

try {
  await access(schemaPath);
  await request('query { __typename }');
} catch (error) {
  console.error(`DefraDB is not ready at ${endpoint}: ${error.message}`);
  process.exit(1);
}

const cliUrl = new URL(defraDbUrl).host;
try {
  const { stdout } = await run('defradb', ['client', 'schema', 'describe', '--url', cliUrl, '--name', 'WorkspaceEntry']);
  if (stdout.includes('WorkspaceEntry')) {
    console.log('WorkspaceEntry schema already exists.');
    process.exit(0);
  }
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('The defradb CLI is not installed or is not on PATH.');
    process.exit(1);
  }
}

const { stdout, stderr } = await run('defradb', ['client', 'schema', 'add', '--url', cliUrl, '-f', schemaPath.pathname]);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
console.log('WorkspaceEntry schema installed.');

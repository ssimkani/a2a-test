import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const npxCommand = isWindows ? 'npx.cmd' : 'npx';
const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 4111);
const baseUrl = `http://${host}:${port}`;
const startupTimeoutMs = Number(process.env.FRAMEWORK_TEST_STARTUP_TIMEOUT_MS ?? 90_000);
const skipBuild = process.argv.includes('--skip-build');
const skipOllama = process.argv.includes('--skip-ollama');
let devProcess;

function section(message) {
  console.log(`\n================================================================`);
  console.log(`[Framework Test] ${message}`);
  console.log(`================================================================`);
}

function pass(message) {
  console.log(`[Framework Test] PASS ${message}`);
}

function run(command, args, label) {
  section(label);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
  }
  pass(label);
}

function currentBranch() {
  const result = spawnSync('git', ['branch', '--show-current'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function assertSupportedNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(
    major > 22 || (major === 22 && minor >= 13),
    `Node.js >=22.13.0 is required; found ${process.version}.`,
  );
  pass(`Node runtime ${process.version} satisfies >=22.13.0.`);
}

async function isPortFree() {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function requireFreePort() {
  if (await isPortFree()) {
    pass(`TCP port ${port} is available.`);
    return;
  }

  const platformHint = isWindows
    ? `Run: Get-NetTCPConnection -LocalPort ${port} | Select-Object OwningProcess; then stop only the stale process.`
    : `Run: lsof -nP -iTCP:${port} -sTCP:LISTEN; then stop only the stale process.`;
  throw new Error(`TCP port ${port} is already in use. ${platformHint}`);
}

function ollamaApiBase() {
  return (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/api').replace(/\/$/, '');
}

function modelMatches(installed, configured) {
  return installed === configured || installed === `${configured}:latest` || `${installed}:latest` === configured;
}

async function testOllama() {
  if (skipOllama) {
    console.log('[Framework Test] SKIP Native Ollama check (--skip-ollama).');
    return;
  }

  section('Native Ollama model and inference');
  const apiBase = ollamaApiBase();
  const model = process.env.KILL_SWITCH_OLLAMA_MODEL?.trim();
  assert.ok(model, 'KILL_SWITCH_OLLAMA_MODEL is missing from .env.');

  let tagsResponse;
  try {
    tagsResponse = await fetch(`${apiBase}/tags`, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(`Ollama is not reachable at ${apiBase}. Start native Ollama and retry.`, {
      cause: error,
    });
  }
  assert.equal(tagsResponse.status, 200, `Ollama /tags returned HTTP ${tagsResponse.status}.`);
  const tags = await tagsResponse.json();
  const installedModels = (tags.models ?? []).map(item => item.name);
  assert.ok(
    installedModels.some(installed => modelMatches(installed, model)),
    `Ollama model '${model}' is not installed. Run: ollama pull ${model}`,
  );

  const generationResponse = await fetch(`${apiBase}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: 'Reply with the single word READY.',
      stream: false,
      options: { temperature: 0, num_predict: 16 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!generationResponse.ok) {
    throw new Error(
      `Ollama generation returned HTTP ${generationResponse.status}: ${await generationResponse.text()}`,
    );
  }
  const generation = await generationResponse.json();
  assert.equal(generation.done, true, 'Ollama did not report a completed generation.');
  assert.ok(typeof generation.response === 'string', 'Ollama response text is missing.');
  pass(`Native Ollama generated a response with '${model}'.`);
}

function authHeaders() {
  const token = process.env.A2A_API_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchOk(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200, `${path} returned HTTP ${response.status}.`);
  return response;
}

function waitForExit(child, timeoutMs) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function stopDevServer() {
  if (!devProcess || devProcess.exitCode !== null || devProcess.signalCode !== null) {
    return;
  }

  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(devProcess.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-devProcess.pid, 'SIGINT');
    } catch {
      devProcess.kill('SIGINT');
    }
  }

  if (!(await waitForExit(devProcess, 10_000))) {
    if (isWindows) {
      spawnSync('taskkill', ['/pid', String(devProcess.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-devProcess.pid, 'SIGKILL');
      } catch {
        devProcess.kill('SIGKILL');
      }
    }
    await waitForExit(devProcess, 5_000);
  }
}

async function waitForMastra(child, getLogs) {
  const deadline = Date.now() + startupTimeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`npm run dev exited early with code ${child.exitCode}.\n${getLogs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/system/api-schema`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still bundling or starting.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Mastra did not become ready within ${startupTimeoutMs}ms.\n${getLogs()}`);
}

async function testDevServer(branch) {
  section(`npm run dev smoke test on port ${port}`);
  await requireFreePort();

  let logs = '';
  const appendLog = chunk => {
    const text = chunk.toString();
    logs = `${logs}${text}`.slice(-40_000);
    process.stdout.write(text);
  };

  devProcess = spawn(npmCommand, ['run', 'dev'], {
    cwd: process.cwd(),
    env: process.env,
    detached: !isWindows,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  devProcess.stdout.on('data', appendLog);
  devProcess.stderr.on('data', appendLog);

  try {
    await waitForMastra(devProcess, () => logs);

    const forbiddenLogs = [
      'EADDRINUSE',
      'No `storage` configured on Mastra',
      'Peer dependency version mismatch detected',
      "Unhandled 'error' event",
    ];
    for (const forbidden of forbiddenLogs) {
      assert.ok(!logs.includes(forbidden), `Dev-server logs contain '${forbidden}'.`);
    }

    const studioHtml = await (await fetchOk('/')).text();
    assert.match(studioHtml, /<title>Mastra Studio<\/title>/, 'Mastra Studio HTML was not returned.');

    const schema = await (await fetchOk('/api/system/api-schema')).json();
    assert.ok(Array.isArray(schema.routes) && schema.routes.length > 0, 'API schema has no routes.');

    const agents = await (await fetchOk('/api/agents')).json();
    const agentIds = Object.values(agents).map(agent => agent.id);
    assert.ok(agentIds.includes('kill-switch-sitrep-agent'), 'Kill-switch SITREP agent is not registered.');
    const branchAgent = branch === 'windows' ? 'windows-agent' : 'a2a-agent';
    assert.ok(agentIds.includes(branchAgent), `${branchAgent} is not registered on branch '${branch}'.`);

    const workflows = await (await fetchOk('/api/workflows')).json();
    const workflowNames = Object.values(workflows).map(workflow => workflow.name);
    assert.ok(workflowNames.includes('kill-switch-workflow'), 'Kill-switch workflow is not registered.');

    pass(`Mastra Studio, API schema, ${branchAgent}, SITREP agent, and kill-switch workflow are reachable.`);
  } finally {
    await stopDevServer();
  }

  assert.ok(await isPortFree(), `Port ${port} remained occupied after the dev-server shutdown.`);
  pass('npm run dev shut down cleanly and released its port.');
}

async function main() {
  section('Cross-platform framework verification');
  const branch = currentBranch();
  console.log(`[Framework Test] Platform=${process.platform} Branch=${branch || 'unknown'} Port=${port}`);
  assertSupportedNodeVersion();
  assert.ok(Number.isInteger(port) && port > 0 && port < 65_536, `Invalid PORT '${process.env.PORT}'.`);

  run(
    npmCommand,
    ['ls', '@mastra/core', '@mastra/libsql', 'mastra', '@orbitdb/core', 'helia'],
    'Dependency-tree validation',
  );
  run(npxCommand, ['tsc', '--noEmit'], 'TypeScript compilation');
  run(npmCommand, ['test'], 'Unit and integration tests');

  if (skipBuild) {
    console.log('[Framework Test] SKIP Production build (--skip-build).');
  } else {
    run(npmCommand, ['run', 'build'], 'Mastra production build');
  }

  run(
    process.execPath,
    ['--import', 'tsx', 'scripts/orbitdb-replication-smoke.ts'],
    'Two-node OrbitDB replication and failover claim',
  );
  await testOllama();
  await testDevServer(branch);

  section('ALL CHECKS PASSED');
  console.log('[Framework Test] This machine passed the same Node/Mastra/OrbitDB/Ollama checks intended for Windows.');
}

process.once('SIGINT', () => void stopDevServer().finally(() => process.exit(130)));
process.once('SIGTERM', () => void stopDevServer().finally(() => process.exit(143)));

main().catch(async error => {
  await stopDevServer();
  console.error('\n[Framework Test] FAIL', error);
  process.exitCode = 1;
});

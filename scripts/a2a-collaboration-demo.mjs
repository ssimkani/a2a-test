import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MastraClient } from '@mastra/client-js';
import {
  SAMPLE_RELATIVE_PATH,
  REQUIRED_MARKERS,
  analyzeSalesCsv,
  assertMarker,
  buildStagePrompt,
  collectA2AText,
  findResponse,
  sha256,
} from './lib/a2a-demo.mjs';

const dryRun = process.argv.includes('--dry-run');
const workspaceRoot = resolve(process.env.LOCAL_WORKSPACE_PATH ?? 'src/mastra/public/workspace');
const samplePath = resolve(workspaceRoot, SAMPLE_RELATIVE_PATH);
const dataset = await readFile(samplePath, 'utf8');
const expected = analyzeSalesCsv(dataset);
const collaborationId = `sales-demo-${new Date().toISOString().replace(/[:.]/g, '-')}`;

if (dryRun) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    collaborationId,
    samplePath,
    sha256: sha256(dataset),
    expected,
    stages: ['TRANSFER_AND_ANALYZE', 'MAC_ANALYSIS_AND_CRITIQUE', 'CRITIQUE_AND_REVISE', 'FINAL_CONSENSUS', 'VERIFY_SAVED_FILE'],
  }, null, 2));
  process.exit(0);
}

const macBaseUrl = process.env.MAC_LOCAL_MASTRA_BASE_URL ?? 'http://127.0.0.1:4111';
const macToken = process.env.MAC_LOCAL_A2A_TOKEN ?? process.env.A2A_API_TOKEN;
const macClient = new MastraClient({
  baseUrl: macBaseUrl,
  apiPrefix: '/api',
  headers: macToken ? { Authorization: `Bearer ${macToken}` } : undefined,
});
const macA2A = macClient.getA2A('a2a-agent');
const sendToWindows = macClient.getTool('send-to-windows-agent');

console.log(`[1/5] Mac tool sends ${SAMPLE_RELATIVE_PATH} to Windows over A2A`);
const transferResult = await sendToWindows.execute({
  data: {
    purpose: 'share-data',
    message: 'Stage TRANSFER_AND_ANALYZE. Save the attached CSV, verify it with read_file, calculate all required metrics, and return WINDOWS_TRANSFER_ANALYSIS_COMPLETE.',
    payload: { stage: 'TRANSFER_AND_ANALYZE', sourceSha256: sha256(dataset) },
    workspaceFiles: [SAMPLE_RELATIVE_PATH],
    collaborationId,
    round: 1,
  },
});
const windowsInitial = findResponse(transferResult);
assertMarker(windowsInitial, REQUIRED_MARKERS.transfer, 'Windows transfer analysis');

console.log('[2/5] Mac agent independently analyzes and critiques over A2A');
const macCritique = await collectA2AText(macA2A, buildStagePrompt({
  stage: 'MAC_ANALYSIS_AND_CRITIQUE', collaborationId, round: 2, dataset, peerAnalysis: windowsInitial,
}), collaborationId);
assertMarker(macCritique, REQUIRED_MARKERS.critique, 'Mac critique');

console.log('[3/5] Windows reads its saved copy and revises over A2A');
const revisionResult = await sendToWindows.execute({
  data: {
    purpose: 'request-critique',
    message: `Stage CRITIQUE_AND_REVISE. Read received/${collaborationId}/sales-data.csv, compare the Mac critique in payload, correct errors, and return WINDOWS_REVISION_COMPLETE.`,
    payload: { stage: 'CRITIQUE_AND_REVISE', macCritique },
    workspaceFiles: [],
    collaborationId,
    round: 3,
  },
});
const windowsRevision = findResponse(revisionResult);
assertMarker(windowsRevision, REQUIRED_MARKERS.revision, 'Windows revision');

console.log('[4/5] Mac agent produces final consensus over A2A');
const consensus = await collectA2AText(macA2A, buildStagePrompt({
  stage: 'FINAL_CONSENSUS', collaborationId, round: 4, dataset,
  peerAnalysis: `WINDOWS INITIAL:\n${windowsInitial}\n\nMAC CRITIQUE:\n${macCritique}\n\nWINDOWS REVISION:\n${windowsRevision}`,
}), collaborationId);
assertMarker(consensus, REQUIRED_MARKERS.consensus, 'Final consensus');

console.log('[5/5] Windows verifies the saved file over A2A');
const verifyResult = await sendToWindows.execute({
  data: {
    purpose: 'status',
    message: `Stage VERIFY_SAVED_FILE. Call read_file on received/${collaborationId}/sales-data.csv. Return FILE_VERIFIED only after a successful read and report the row count.`,
    payload: { stage: 'VERIFY_SAVED_FILE', expectedRows: expected.rowCount, sourceSha256: sha256(dataset) },
    workspaceFiles: [],
    collaborationId,
    round: 5,
  },
});
const verification = findResponse(verifyResult);
assertMarker(verification, REQUIRED_MARKERS.verification, 'Windows file verification');

const reportDir = resolve(workspaceRoot, 'demo-output');
await mkdir(reportDir, { recursive: true });
const reportPath = resolve(reportDir, `${collaborationId}-consensus.md`);
await writeFile(reportPath, `# A2A collaboration consensus\n\nCollaboration: ${collaborationId}\n\n## Windows initial analysis\n\n${windowsInitial}\n\n## Mac critique\n\n${macCritique}\n\n## Windows revision\n\n${windowsRevision}\n\n## Final consensus\n\n${consensus}\n\n## Windows file verification\n\n${verification}\n`, 'utf8');
console.log(`Demo passed. Consensus: ${reportPath}`);
console.log(`On Windows, run: npm run demo:verify-workspace -- ${collaborationId}`);

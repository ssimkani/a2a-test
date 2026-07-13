import type { InputProcessor, ProcessInputArgs } from '@mastra/core/processors';
import { basename } from 'node:path';
import { windowsAgentWorkspace } from '../workspace';

interface PeerFile {
  name: string;
  encoding: 'utf-8' | 'base64';
  content: string;
}

interface PeerEnvelope {
  protocol: 'edge-peer-collaboration/v1';
  collaborationId: string;
  payload?: { stage?: unknown; macCritique?: unknown };
  files: PeerFile[];
}

function textFromMessage(message: ProcessInputArgs['messages'][number]): string {
  const parts = message.content.parts ?? [];
  return parts
    .filter((part): part is typeof part & { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n');
}

function parseEnvelope(text: string): PeerEnvelope | undefined {
  const match = text.match(/<peer-envelope>\s*([\s\S]*?)\s*<\/peer-envelope>/);
  if (!match) return undefined;
  const value: unknown = JSON.parse(match[1]);
  if (!value || typeof value !== 'object') throw new Error('A2A peer envelope must be an object');
  const envelope = value as Partial<PeerEnvelope>;
  if (envelope.protocol !== 'edge-peer-collaboration/v1' || typeof envelope.collaborationId !== 'string' || !Array.isArray(envelope.files)) {
    throw new Error('A2A peer envelope is missing protocol, collaborationId, or files');
  }
  return envelope as PeerEnvelope;
}

function replaceText(message: ProcessInputArgs['messages'][number], text: string) {
  return {
    ...message,
    content: {
      ...message.content,
      parts: [{ type: 'text' as const, text }],
    },
  };
}

function verifiedFacts(csv: string): string {
  const [, ...lines] = csv.trim().split(/\r?\n/);
  const rows = lines.map(line => {
    const [product, units, revenue, returns] = line.split(',');
    return { product, units: Number(units), revenue: Number(revenue), returns: Number(returns) };
  });
  if (rows.length === 0 || rows.some(row => !row.product || !Number.isFinite(row.units) || !Number.isFinite(row.revenue) || !Number.isFinite(row.returns))) {
    throw new Error('Saved A2A sales CSV is invalid');
  }
  const highestUnits = rows.reduce((best, row) => row.units > best.units ? row : best);
  const highestRevenue = rows.reduce((best, row) => row.revenue > best.revenue ? row : best);
  const rates = rows.map(row => ({ ...row, rate: row.returns / row.units * 100 }));
  const highestRate = rates.reduce((best, row) => row.rate > best.rate ? row : best);
  const lowestRate = rates.reduce((best, row) => row.rate < best.rate ? row : best);
  return [
    `total_revenue=${rows.reduce((sum, row) => sum + row.revenue, 0)}`,
    `highest_units=${highestUnits.product} (${highestUnits.units})`,
    `highest_revenue=${highestRevenue.product} (${highestRevenue.revenue})`,
    `highest_return_rate=${highestRate.product} (${highestRate.returns}/${highestRate.units}= ${highestRate.rate}%)`,
    `lowest_return_rate=${lowestRate.product} (${lowestRate.returns}/${lowestRate.units}= ${lowestRate.rate}%)`,
  ].join('\n');
}

export const a2aFilePersistenceProcessor: InputProcessor = {
  id: 'a2a-file-persistence',
  async processInput({ messages }: ProcessInputArgs) {
    const filesystem = windowsAgentWorkspace.filesystem;
    if (!filesystem) throw new Error('Windows local workspace filesystem is required');

    return Promise.all(messages.map(async message => {
      const text = textFromMessage(message);
      const envelope = parseEnvelope(text);
      if (!envelope) return message;
      const stage = typeof envelope.payload?.stage === 'string' ? envelope.payload.stage : '';
      const savedPaths: string[] = [];

      for (const file of envelope.files) {
        if (!file || typeof file.name !== 'string' || typeof file.content !== 'string' || !['utf-8', 'base64'].includes(file.encoding)) {
          throw new Error('A2A peer envelope contains an invalid file');
        }
        const safeName = basename(file.name);
        const path = `received/${envelope.collaborationId}/${safeName}`;
        const bytes = Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
        await filesystem.writeFile(path, bytes, { recursive: true, overwrite: true });
        const verified = Buffer.from(await filesystem.readFile(path, { encoding: 'binary' }));
        if (!verified.equals(bytes)) throw new Error(`A2A transport verification failed for ${path}`);
        savedPaths.push(path);
      }

      const savedDatasetPath = `received/${envelope.collaborationId}/sales-data.csv`;
      let savedDataset = envelope.files.find(file => file.name === 'sales-data.csv')?.content ?? '';
      if (stage === 'CRITIQUE_AND_REVISE' || stage === 'VERIFY_SAVED_FILE') {
        savedDataset = Buffer.from(await filesystem.readFile(savedDatasetPath, { encoding: 'binary' })).toString('utf8');
      }

      const receipt = [
        'TRANSPORT_PERSISTENCE_RECEIPT',
        `collaborationId=${envelope.collaborationId}`,
        ...savedPaths.map(path => `saved_and_byte_verified=${path}`),
        savedDataset ? `TRANSPORT_SAVED_DATASET\n${savedDataset}\nEND_TRANSPORT_SAVED_DATASET` : '',
        stage === 'VERIFY_SAVED_FILE' && savedDataset ? 'TRANSPORT_FILE_VERIFIED' : '',
      ].filter(Boolean).join('\n');
      const marker = stage === 'TRANSFER_AND_ANALYZE'
        ? 'WINDOWS_TRANSFER_ANALYSIS_COMPLETE'
        : stage === 'CRITIQUE_AND_REVISE'
          ? 'WINDOWS_REVISION_COMPLETE'
          : stage === 'VERIFY_SAVED_FILE'
            ? 'FILE_VERIFIED'
            : 'STAGE_COMPLETE';
      const peerCritique = typeof envelope.payload?.macCritique === 'string'
        ? envelope.payload.macCritique.slice(0, 1_500)
        : '';
      const compactPrompt = [
        `STAGE=${stage}`,
        receipt,
        savedDataset ? `DATASET\n${savedDataset}\nEND_DATASET` : '',
        savedDataset ? `TRANSPORT_VERIFIED_FACTS\n${verifiedFacts(savedDataset)}` : '',
        peerCritique ? `MAC_CRITIQUE\n${peerCritique}\nEND_MAC_CRITIQUE` : '',
        'TASK: State whether you agree with the verified facts. Give one useful business insight. Use only the data above.',
        `FINAL LINE MUST BE EXACTLY: ${marker}`,
      ].filter(Boolean).join('\n\n');
      return replaceText(message, compactPrompt);
    }));
  },
};

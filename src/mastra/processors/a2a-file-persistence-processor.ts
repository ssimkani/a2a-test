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
  payload?: { stage?: unknown };
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

function appendReceipt(message: ProcessInputArgs['messages'][number], receipt: string) {
  return {
    ...message,
    content: {
      ...message.content,
      parts: [...(message.content.parts ?? []), { type: 'text' as const, text: `\n${receipt}` }],
    },
  };
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
      let savedDataset = '';
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
      return appendReceipt(message, receipt);
    }));
  },
};

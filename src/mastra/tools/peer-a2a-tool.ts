import { MastraClient } from '@mastra/client-js';
import type { Message, Task, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from '@mastra/core/a2a/client';
import { createTool } from '@mastra/core/tools';
import type { Workspace } from '@mastra/core/workspace';
import { basename } from 'node:path';
import { z } from 'zod';

const MAX_COLLABORATION_ROUNDS = 5;

const peerMessageInputSchema = z.object({
  purpose: z
    .enum(['share-data', 'request-analysis', 'request-critique', 'answer', 'status'])
    .describe('Reason for contacting the peer agent.'),
  message: z.string().min(1).describe('Message for the peer agent.'),
  payload: z.record(z.string(), z.unknown()).default({}).describe('Optional structured JSON to send.'),
  workspaceFiles: z.array(z.string().min(1)).default([]).describe('Optional workspace file paths to attach.'),
  collaborationId: z.string().min(1).optional(),
  round: z.number().int().min(1).max(MAX_COLLABORATION_ROUNDS).default(1),
});

const peerMessageOutputSchema = z.object({
  collaborationId: z.string(),
  round: z.number().int(),
  messageId: z.string(),
  taskId: z.string().optional(),
  response: z.string(),
  responseData: z.array(z.record(z.string(), z.unknown())),
  sentFiles: z.array(z.string()),
  transcriptPath: z.string(),
});

type A2AStreamEvent = Message | Task | TaskArtifactUpdateEvent | TaskStatusUpdateEvent;
type A2APart = Message['parts'][number];

interface PeerA2AToolOptions {
  id: string;
  description: string;
  sourceAgentId: string;
  targetAgentId: string;
  baseUrlEnv: string;
  agentIdEnv: string;
  apiPrefixEnv: string;
  tokenEnv: string;
  workspace: Workspace;
}

function textFromParts(parts: A2APart[]): string {
  return parts
    .filter((part): part is Extract<A2APart, { kind: 'text' }> => part.kind === 'text')
    .map((part) => part.text)
    .join('');
}

function dataFromParts(parts: A2APart[]): Array<Record<string, unknown>> {
  return parts
    .filter((part): part is Extract<A2APart, { kind: 'data' }> => part.kind === 'data')
    .map((part) => part.data);
}

function mediaTypeFor(path: string): string {
  const extension = path.toLowerCase().split('.').pop();
  const mediaTypes: Record<string, string> = {
    csv: 'text/csv',
    json: 'application/json',
    jsonl: 'application/x-ndjson',
    md: 'text/markdown',
    pdf: 'application/pdf',
    txt: 'text/plain',
    yaml: 'application/yaml',
    yml: 'application/yaml',
  };

  return mediaTypes[extension ?? ''] ?? 'application/octet-stream';
}

function promptForPeer(
  input: z.infer<typeof peerMessageInputSchema>,
  options: PeerA2AToolOptions,
  collaborationId: string,
  envelope: Record<string, unknown>,
) {
  return `[Peer A2A message]
Source agent: ${options.sourceAgentId}
Target agent: ${options.targetAgentId}
Purpose: ${input.purpose}
Collaboration ID: ${collaborationId}
Round: ${input.round}/${MAX_COLLABORATION_ROUNDS}

${input.message}

The structured JSON and workspace file payload follows. The file content is embedded in this envelope; the sender's workspace path does not exist in your local workspace. Read text content directly from the envelope. If you need a local copy, write it beneath a2a/inbox/${collaborationId}/. Text files contain UTF-8 content; binary files contain base64 content.

<peer-envelope>
${JSON.stringify(envelope, null, 2)}
</peer-envelope>

Do not initiate another peer call merely to acknowledge this message. If a substantive follow-up is necessary, reuse the collaboration ID and increment the round. Do not continue beyond round ${MAX_COLLABORATION_ROUNDS}.`;
}

export function createPeerA2ATool(options: PeerA2AToolOptions) {
  return createTool({
    id: options.id,
    description: options.description,
    strict: true,
    inputSchema: peerMessageInputSchema,
    inputExamples: [
      {
        input: {
          purpose: 'share-data',
          message: 'Here is the requested data.',
          payload: {},
          workspaceFiles: [],
          round: 1,
        },
      },
    ],
    outputSchema: peerMessageOutputSchema,
    execute: async (inputData, context) => {
      const workspace = context?.workspace ?? options.workspace;
      const filesystem = workspace?.filesystem;

      if (!filesystem) {
        throw new Error(`${options.sourceAgentId} requires a filesystem workspace to use ${options.id}`);
      }

      const baseUrl = process.env[options.baseUrlEnv];
      const targetAgentId = process.env[options.agentIdEnv] ?? options.targetAgentId;
      const apiPrefix = process.env[options.apiPrefixEnv] ?? '/api';
      const token = process.env[options.tokenEnv];

      if (!baseUrl) {
        throw new Error(`${options.baseUrlEnv} is required to contact ${options.targetAgentId}`);
      }

      const collaborationId = inputData.collaborationId ?? crypto.randomUUID();
      const messageId = crypto.randomUUID();
      const files: Array<{
        name: string;
        mimeType: string;
        encoding: 'utf-8' | 'base64';
        content: string;
      }> = [];

      for (const path of inputData.workspaceFiles) {
        const content = await filesystem.readFile(path, { encoding: 'binary' });
        const buffer = Buffer.from(content);
        const mimeType = mediaTypeFor(path);
        const isText = mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/x-ndjson';
        files.push({
          name: basename(path),
          mimeType,
          encoding: isText ? 'utf-8' : 'base64',
          content: isText ? buffer.toString('utf8') : buffer.toString('base64'),
        });
      }

      const envelope = {
        protocol: 'edge-peer-collaboration/v1',
        sourceAgent: options.sourceAgentId,
        targetAgent: targetAgentId,
        purpose: inputData.purpose,
        collaborationId,
        round: inputData.round,
        maxRounds: MAX_COLLABORATION_ROUNDS,
        payload: inputData.payload,
        files,
      };
      const parts: A2APart[] = [
        {
          kind: 'text',
          text: promptForPeer(inputData, options, collaborationId, envelope),
        },
      ];

      const client = new MastraClient({
        baseUrl,
        apiPrefix,
        retries: 2,
        backoffMs: 250,
        maxBackoffMs: 1_000,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const stream = client.getA2A(targetAgentId).sendMessageStream({
        message: {
          kind: 'message',
          role: 'user',
          messageId,
          parts,
          contextId: collaborationId,
          metadata: {
            sourceAgent: options.sourceAgentId,
            targetAgent: targetAgentId,
            purpose: inputData.purpose,
            collaborationId,
            round: inputData.round,
            maxRounds: MAX_COLLABORATION_ROUNDS,
          },
        },
      });

      const artifactText = new Map<string, string>();
      const responseData: Array<Record<string, unknown>> = [];
      let messageText = '';
      let taskId: string | undefined;
      let finalState: string | undefined;
      let failureMessage = '';

      for await (const event of stream) {
        if (event.kind === 'task') {
          taskId = event.id;
        } else if (event.kind === 'status-update' || event.kind === 'artifact-update') {
          taskId = event.taskId;
        }

        if (event.kind === 'message') {
          messageText += textFromParts(event.parts);
          responseData.push(...dataFromParts(event.parts));
        }

        if (event.kind === 'status-update' && event.final) {
          finalState = event.status.state;
          if (event.status.message) {
            failureMessage = textFromParts(event.status.message.parts);
          }
        }

        if (event.kind === 'artifact-update') {
          const artifactId = event.artifact.artifactId;
          const text = textFromParts(event.artifact.parts);
          artifactText.set(artifactId, event.append ? `${artifactText.get(artifactId) ?? ''}${text}` : text);
          responseData.push(...dataFromParts(event.artifact.parts));
        }
      }

      const response = (artifactText.size > 0 ? [...artifactText.values()].join('\n') : messageText).trim();
      const transcriptPath = `a2a/${collaborationId}/round-${inputData.round}-${options.sourceAgentId}-to-${targetAgentId}.json`;

      await filesystem.writeFile(
        transcriptPath,
        JSON.stringify(
          {
            protocol: 'edge-peer-collaboration/v1',
            collaborationId,
            round: inputData.round,
            maxRounds: MAX_COLLABORATION_ROUNDS,
            messageId,
            taskId,
            sourceAgent: options.sourceAgentId,
            targetAgent: targetAgentId,
            purpose: inputData.purpose,
            message: inputData.message,
            payload: inputData.payload,
            sentFiles: inputData.workspaceFiles,
            response,
            responseData,
            finalState,
            failureMessage,
            completedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        { recursive: true, overwrite: true },
      );

      if (finalState === 'failed') {
        throw new Error(`Peer A2A task failed${failureMessage ? `: ${failureMessage}` : ''}`);
      }

      return {
        collaborationId,
        round: inputData.round,
        messageId,
        taskId,
        response,
        responseData,
        sentFiles: inputData.workspaceFiles,
        transcriptPath,
      };
    },
  });
}

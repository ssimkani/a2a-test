import type { Message, Task, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from '@mastra/core/a2a/client';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { getVmA2AClient } from '../a2a/vm-client';

const transcriptEntrySchema = z.object({
  speaker: z.string(),
  message: z.string(),
});

const conversationInputSchema = z.object({
  opener: z
    .string()
    .default('Say hello to the VM agent and start a short, friendly small-talk conversation.')
    .describe('The opening instruction for the MacBook agent'),
  turns: z
    .number()
    .int()
    .min(2)
    .max(10)
    .default(4)
    .describe('Total number of agent replies to exchange'),
});

const conversationOutputSchema = z.object({
  transcript: z.array(transcriptEntrySchema),
});

type A2AStreamEventData = Message | Task | TaskArtifactUpdateEvent | TaskStatusUpdateEvent;

function textFromParts(parts: Array<{ kind: string; text?: string }>): string {
  return parts
    .filter((part): part is { kind: 'text'; text: string } => part.kind === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function textFromMessageEvent(event: A2AStreamEventData): string {
  if (event.kind === 'message') {
    return textFromParts(event.parts);
  }

  return '';
}

async function sendToVmAgent(prompt: string): Promise<string> {
  const { vmA2A } = getVmA2AClient();
  const stream = vmA2A.sendMessageStream({
    message: {
      kind: 'message',
      role: 'user',
      messageId: crypto.randomUUID(),
      parts: [{ kind: 'text', text: prompt }],
    },
  });

  const artifacts = new Map<string, string>();
  let fallbackResponse = '';

  for await (const event of stream) {
    if (event.kind === 'artifact-update') {
      const artifactId = event.artifact.artifactId;
      const chunk = textFromParts(event.artifact.parts);
      const response = event.append ? `${artifacts.get(artifactId) ?? ''}${chunk}` : chunk;

      artifacts.set(artifactId, response);
      fallbackResponse = response;
      continue;
    }

    fallbackResponse += textFromMessageEvent(event);
  }

  return (artifacts.size > 0 ? [...artifacts.values()].join('') : fallbackResponse).trim();
}

const runA2AConversation = createStep({
  id: 'run-a2a-conversation',
  description: 'Runs a brief small-talk exchange between the MacBook agent and the VM agent',
  inputSchema: conversationInputSchema,
  outputSchema: conversationOutputSchema,
  execute: async ({ inputData, mastra }) => {
    const macbookAgent = mastra?.getAgent('a2aAgent');

    if (!macbookAgent) {
      throw new Error('MacBook A2A agent not found');
    }

    const transcript: z.infer<typeof transcriptEntrySchema>[] = [];
    let nextPrompt = inputData.opener;

    for (let turn = 0; turn < inputData.turns; turn += 1) {
      const isMacbookTurn = turn % 2 === 0;

      if (isMacbookTurn) {
        const response = await macbookAgent.generate(nextPrompt, {
          modelSettings: {
            maxOutputTokens: 120,
            temperature: 0.7,
          },
        });
        const message = response.text.trim();

        transcript.push({
          speaker: 'MacBook A2A Agent',
          message,
        });
        nextPrompt = `The MacBook agent said: "${message}"\n\nReply as the VM agent with one brief small-talk response.`;
      } else {
        const message = await sendToVmAgent(nextPrompt);

        transcript.push({
          speaker: 'VM A2A Agent',
          message,
        });
        nextPrompt = `The VM agent said: "${message}"\n\nReply as the MacBook agent with one brief small-talk response.`;
      }
    }

    return { transcript };
  },
});

export const a2aConversationWorkflow = createWorkflow({
  id: 'a2a-conversation-workflow',
  inputSchema: conversationInputSchema,
  outputSchema: conversationOutputSchema,
})
  .then(runA2AConversation)
  .commit();

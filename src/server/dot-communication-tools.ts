import { defineTool } from '@copilotkit/runtime/v2';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PlatformConfig } from './platform-config.js';
import type { WorkspaceStore } from './workspace.js';
import { runThreadTurn } from './headless.js';

export function dotCommunicationTools(
  workspace: WorkspaceStore,
  config: PlatformConfig,
  callerDotId: string,
  check: () => void,
  signal: AbortSignal,
) {
  const headers: Record<string, string> = config.ownerToken
    ? { Authorization: `Bearer ${config.ownerToken}` }
    : {};

  return [
    defineTool({
      name: 'list_dots',
      description:
        'List all peer Dots in this workspace (excluding yourself). Returns their id, name, and a brief summary of their role.',
      parameters: z.object({}),
      execute: async () => {
        check();
        return workspace
          .dots()
          .filter((dot) => dot.id !== callerDotId)
          .map((dot) => ({
            id: dot.id,
            name: dot.name,
            instructions: dot.instructions.slice(0, 200),
          }));
      },
    }),

    defineTool({
      name: 'ping_dot',
      description:
        'Send a message to a peer Dot and return its response. Use list_dots first to find the target Dot id.',
      parameters: z.object({
        dot_id: z.string().min(1).describe('The id of the target Dot.'),
        message: z
          .string()
          .min(1)
          .max(4000)
          .describe('The message or task to delegate.'),
      }),
      execute: async ({ dot_id, message }) => {
        check();
        const target = workspace.dot(dot_id);
        if (!target)
          throw new Error(`Dot with id "${dot_id}" not found in this workspace.`);
        if (dot_id === callerDotId)
          throw new Error('A Dot cannot ping itself.');
        const threadId = randomUUID();
        const pingSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(60_000),
        ]);
        const response = await runThreadTurn(
          config.runtimeUrl,
          headers,
          dot_id,
          threadId,
          message,
          pingSignal,
        );
        return { from_dot: callerDotId, dot_id, response };
      },
    }),
  ];
}

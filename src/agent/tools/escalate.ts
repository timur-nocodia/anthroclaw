import { z } from 'zod';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';

/**
 * Resolves the JSONL escalation log path for an agent.
 *
 * Honors the `OC_DATA_DIR` env var so tests (and alternate deployments) can
 * redirect the data root. Falls back to the literal `'data'` directory
 * relative to the current working directory.
 */
function escalationPath(agentId: string): string {
  return resolve(
    process.env.OC_DATA_DIR ?? 'data',
    'escalations',
    `${agentId}.jsonl`,
  );
}

/**
 * Universal `escalate` MCP tool.
 *
 * Lets an agent route a question to a human operator by appending a
 * structured event to `<OC_DATA_DIR or 'data'>/escalations/<agentId>.jsonl`.
 * Operator-side surfacing (UI, webhooks, notifications) is intentionally
 * out of scope for v0.8.0 — agents only WRITE; another process or future
 * UI page reads.
 *
 * The description is deliberately worded to discourage hallucinated
 * technical excuses ("invent") and reserve the tool for genuine human
 * attention ("human"). Both anchor words are checked by the unit test
 * to prevent accidental softening of the guidance.
 *
 * `agentId` is captured in the factory closure — the SDK's runtime `extra`
 * argument is intentionally not consulted, since the agent loading the
 * tool is always the correct attribution target.
 */
export function createEscalateTool(agentId: string): ToolDefinition {
  const sdkTool = tool(
    'escalate',
    'Route a question to the human operator. Use ONLY when the client asks ' +
      'for something you cannot fulfill AND the matter genuinely needs human ' +
      'attention. Do NOT use for trivial refusals — use a plain refusal instead. ' +
      'Do NOT invent technical excuses.',
    {
      summary: z
        .string()
        .describe('One-sentence description of what the client asked.'),
      urgency: z
        .enum(['routine', 'urgent'])
        .optional()
        .describe('Urgency level. Default: routine.'),
      suggested_action: z
        .string()
        .optional()
        .describe('What the operator should do. Optional.'),
    },
    async (args: Record<string, unknown>) => {
      const summary = args.summary as string;
      const urgency =
        (args.urgency as 'routine' | 'urgent' | undefined) ?? 'routine';
      const suggestedAction = args.suggested_action as string | undefined;

      const event: Record<string, unknown> = {
        ts: Date.now(),
        agentId,
        summary,
        urgency,
      };
      if (suggestedAction !== undefined) {
        event.suggested_action = suggestedAction;
      }

      const path = escalationPath(agentId);
      try {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, JSON.stringify(event) + '\n', { mode: 0o640 });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: `Failed to log escalation: ${reason}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: 'Escalation logged. The operator will respond.',
          },
        ],
      };
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

export const META: ToolMeta = {
  category: 'safety',
  safe_in_public: true,
  safe_in_trusted: true,
  safe_in_private: true,
  destructive: false,
  reads_only: false,
  hard_blacklist_in: [],
};

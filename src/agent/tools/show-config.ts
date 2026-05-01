import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { HumanTakeoverSchema, NotificationsSchema } from '../../config/schema.js';
import type { AgentConfigWriter } from '../../config/writer.js';
import type { ConfigAuditLog, PersistedAuditEntry } from '../../config/audit.js';
import type { ConfigSection } from '../../config/writer.js';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';
import type { CanManageFn } from './manage-notifications.js';

/**
 * Mirror of the operator-console plugin's `OperatorConsoleConfigSchema`,
 * lifted here so the read-side `show_config` can fill defaults without
 * crossing the backend rootDir boundary. Both definitions must stay in
 * sync with `plugins/operator-console/src/config.ts`.
 */
const OperatorConsoleSchemaMirror = z.object({
  enabled: z.boolean().default(false),
  manages: z.union([z.literal('*'), z.array(z.string().min(1))]).default([]),
  capabilities: z
    .array(z.enum(['peer_pause', 'delegate', 'list_peers', 'peer_summary', 'escalate']))
    .default(['peer_pause', 'delegate', 'list_peers', 'peer_summary', 'escalate']),
});

const SectionEnum = z.enum(['notifications', 'human_takeover', 'operator_console', 'all']);

const InputSchema = z.object({
  target_agent_id: z.string().min(1).optional(),
  sections: z.array(SectionEnum).min(1).optional(),
});

type Input = z.infer<typeof InputSchema>;

export interface CreateShowConfigOptions {
  agentId: string;
  writer: AgentConfigWriter;
  auditLog?: ConfigAuditLog;
  canManage: CanManageFn;
}

const ALL_SECTIONS: ConfigSection[] = ['notifications', 'human_takeover', 'operator_console'];

function withDefaults(section: ConfigSection, value: unknown): unknown {
  switch (section) {
    case 'notifications':
      return NotificationsSchema.parse(value ?? {});
    case 'human_takeover':
      return HumanTakeoverSchema.parse(value ?? {});
    case 'operator_console':
      return OperatorConsoleSchemaMirror.parse(value ?? {});
  }
}

function expandSections(input: Input): ConfigSection[] {
  if (!input.sections || input.sections.length === 0) return [...ALL_SECTIONS];
  if (input.sections.includes('all')) return [...ALL_SECTIONS];
  // After filtering out 'all', the remaining values are guaranteed to be ConfigSection.
  return input.sections.filter((s): s is ConfigSection => s !== 'all');
}

export function createShowConfigTool(opts: CreateShowConfigOptions): ToolDefinition {
  const { agentId: callerId, writer, auditLog, canManage } = opts;

  const sdkTool = tool(
    'show_config',
    'Read current notifications / human_takeover / operator_console config sections (with schema defaults applied) plus the most recent audit entry.',
    {
      target_agent_id: z.string().optional().describe('Agent to inspect. Omit for self.'),
      sections: z.array(SectionEnum).min(1).optional()
        .describe('Sections to return. Use "all" or omit for all three.'),
    },
    async (args: Record<string, unknown>) => {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        const summary = parsed.error.issues
          .map((i) => `${i.path.map(String).join('.') || '<root>'}: ${i.message}`)
          .join('; ');
        return {
          content: [{ type: 'text', text: `Invalid input: ${summary}` }],
          isError: true,
        };
      }
      const input: Input = parsed.data;
      const targetId = input.target_agent_id ?? callerId;

      // Self read is unconditional; cross-agent read still goes through the
      // canManage check (mirrors the spec's permission matrix for show_config).
      if (targetId !== callerId && !canManage(callerId, targetId)) {
        return {
          content: [{ type: 'text', text: `Error: caller "${callerId}" is not authorized to inspect agent "${targetId}".` }],
          isError: true,
        };
      }

      try {
        const sections = expandSections(input);
        const out: Record<string, unknown> = {};
        for (const s of sections) {
          out[s] = withDefaults(s, writer.readSection(targetId, s));
        }
        let lastModified: { at: string; by: string; section: ConfigSection; source: string } | undefined;
        if (auditLog) {
          // Find the most recent audit entry across the requested sections.
          const recents = await Promise.all(
            sections.map((s) => auditLog.readRecent(targetId, { limit: 1, section: s })),
          );
          const flat: PersistedAuditEntry[] = recents.flat();
          if (flat.length > 0) {
            flat.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
            const top = flat[0];
            lastModified = {
              at: top.ts,
              by: top.callerAgent,
              section: top.section,
              source: top.source,
            };
          }
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              agent_id: targetId,
              sections: out,
              ...(lastModified ? { last_modified: lastModified } : {}),
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

export const META: ToolMeta = {
  category: 'read-only',
  safe_in_public: true, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: true, hard_blacklist_in: [],
  description: 'Read current config sections (notifications/human_takeover/operator_console).',
  reasoning: 'Read-only; safe in all profiles.',
};

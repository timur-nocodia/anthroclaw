import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { FileArtifactStore } from '../../auto-buildroom/artifacts/store.js';
import {
  createSessionSummaryArtifact,
  type SessionSummarySignal,
} from '../../auto-buildroom/sessions/session-summary.js';
import { loadBuildroomRoomConfig } from '../../auto-buildroom/storage/init.js';
import type { ToolMeta } from '../../security/types.js';
import type { ToolDefinition } from './types.js';

export interface BuildroomSessionSummaryToolOptions {
  projectRoot: string;
  roomId: string;
  sourceAgentId: string;
  sourceSessionId?: string;
  now?: () => string;
}

const CandidateSignalSchema = z.object({
  type: z.string().min(1),
  text: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
});

export function createBuildroomSessionSummaryTool(
  opts: BuildroomSessionSummaryToolOptions,
): ToolDefinition {
  const sdkTool = tool(
    'buildroom_submit_session_summary',
    'Submit a sanitized ordinary-agent session summary to Auto-Buildroom. Do not include raw transcripts, secrets, or approval.',
    {
      user_intent: z.string().min(1).describe('Short sanitized description of what the user wanted.'),
      observed_friction: z.array(z.string()).default([]).describe('Concrete sanitized friction observed in the session.'),
      candidate_signals: z.array(CandidateSignalSchema).default([]).describe('Potential Buildroom research signals.'),
      evidence_excerpt: z.string().optional().describe('Short sanitized excerpt or pointer, not a full transcript.'),
      source_session_id: z.string().optional().describe('Source ordinary-agent session ID. Required if not bound by dispatch context.'),
    },
    async (args: Record<string, unknown>) => {
      try {
        const sourceSessionId = opts.sourceSessionId
          ?? (typeof args.source_session_id === 'string' ? args.source_session_id : undefined);
        if (!sourceSessionId) {
          return {
            content: [{ type: 'text', text: 'Buildroom session summary failed: source_session_id is required.' }],
            isError: true,
          };
        }
        loadBuildroomRoomConfig(opts.projectRoot, opts.roomId);

        const now = opts.now?.() ?? new Date().toISOString();
        const candidateSignals = parseCandidateSignals(args.candidate_signals);
        const evidenceRefs = typeof args.evidence_excerpt === 'string' && args.evidence_excerpt.trim()
          ? [{
              type: 'session',
              ref: sourceSessionId,
              excerpt: args.evidence_excerpt.trim(),
            }]
          : [];
        const artifact = createSessionSummaryArtifact({
          roomId: opts.roomId,
          sourceAgentId: opts.sourceAgentId,
          sourceSessionId,
          now,
          summary: {
            userIntent: String(args.user_intent),
            observedFriction: Array.isArray(args.observed_friction)
              ? args.observed_friction.filter((item): item is string => typeof item === 'string')
              : [],
            candidateSignals,
            evidenceRefs,
          },
        });
        const store = new FileArtifactStore({ projectRoot: opts.projectRoot, roomId: opts.roomId });
        const written = store.writeArtifact(artifact);
        return {
          content: [{
            type: 'text',
            text: [
              `Buildroom session summary submitted: ${written.id}`,
              'Summary is sanitized evidence. It cannot approve or build work.',
            ].join('\n'),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Buildroom session summary failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

export function bindBuildroomSessionSummaryToolForDispatch(
  toolDefinition: ToolDefinition,
  opts: BuildroomSessionSummaryToolOptions & { sourceSessionId: string },
): ToolDefinition {
  if (toolDefinition.name !== 'buildroom_submit_session_summary') return toolDefinition;
  return createBuildroomSessionSummaryTool(opts);
}

export function bindBuildroomSessionSummaryToolsForDispatch(
  tools: ToolDefinition[],
  opts: BuildroomSessionSummaryToolOptions & { sourceSessionId: string },
): ToolDefinition[] {
  return tools.map((toolDefinition) => bindBuildroomSessionSummaryToolForDispatch(toolDefinition, opts));
}

function parseCandidateSignals(value: unknown): SessionSummarySignal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SessionSummarySignal[] => {
    const parsed = CandidateSignalSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export const META: ToolMeta = {
  category: 'agent-config',
  safe_in_public: false,
  safe_in_trusted: true,
  safe_in_private: true,
  destructive: false,
  reads_only: false,
  hard_blacklist_in: [],
};

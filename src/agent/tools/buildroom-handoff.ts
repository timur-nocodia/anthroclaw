import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { FileArtifactStore } from '../../auto-buildroom/artifacts/store.js';
import { createHandoffSignalArtifact } from '../../auto-buildroom/sessions/handoff-signal.js';
import type { ToolMeta } from '../../security/types.js';
import type { ToolDefinition } from './types.js';

export interface BuildroomHandoffToolOptions {
  projectRoot: string;
  roomId: string;
  sourceAgentId: string;
  sourceSessionId: string;
  now?: () => string;
}

export function createBuildroomHandoffTool(opts: BuildroomHandoffToolOptions): ToolDefinition {
  const sdkTool = tool(
    'buildroom_submit_signal',
    'Submit a structured signal to Auto-Buildroom. This is a handoff only: it cannot approve, build, or grant authority.',
    {
      signal_type: z.string().min(1).describe('Signal type, for example friction, docs_gap, test_gap, or operator_confusion.'),
      summary: z.string().min(1).describe('Short sanitized description of what the agent noticed.'),
      evidence_summary_id: z.string().min(1).describe('Existing session_summary artifact ID used as evidence.'),
      confidence: z.enum(['low', 'medium', 'high']).default('medium'),
      requested_action: z.enum(['research_only', 'create_idea_candidate']).default('research_only'),
      target_buildroom: z.string().optional().describe('Optional target Buildroom ID. Defaults to current room.'),
    },
    async (args: Record<string, unknown>) => {
      try {
        const now = opts.now?.() ?? new Date().toISOString();
        const artifact = createHandoffSignalArtifact({
          roomId: opts.roomId,
          sourceAgentId: opts.sourceAgentId,
          sourceSessionId: opts.sourceSessionId,
          targetBuildroom: typeof args.target_buildroom === 'string' ? args.target_buildroom : opts.roomId,
          signalType: String(args.signal_type),
          summary: String(args.summary),
          evidenceRefs: [{ kind: 'artifact', ref: String(args.evidence_summary_id) }],
          confidence: args.confidence === 'low' || args.confidence === 'high' ? args.confidence : 'medium',
          requestedAction: args.requested_action === 'create_idea_candidate'
            ? 'create_idea_candidate'
            : 'research_only',
          now,
        });
        const store = new FileArtifactStore({ projectRoot: opts.projectRoot, roomId: opts.roomId });
        const written = store.writeArtifact(artifact);
        return {
          content: [{
            type: 'text',
            text: [
              `Buildroom handoff submitted: ${written.id}`,
              'Handoff is not approval. Buildroom must review and approve before execution.',
            ].join('\n'),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Buildroom handoff failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
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

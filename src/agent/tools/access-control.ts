import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { AccessControl } from '../../routing/access.js';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';

export function createAccessControlTool(
  agentId: string,
  accessControl: AccessControl,
): ToolDefinition {
  const sdkTool = tool(
    'access_control',
    'Manage access control for this agent. List pending users, approve or revoke access.',
    {
      action: z.enum(['list_pending', 'list_approved', 'approve', 'revoke']).describe(
        'Action to perform',
      ),
      sender_id: z.string().optional().describe('Sender ID to approve or revoke (required for approve/revoke)'),
    },
    async (args: Record<string, unknown>) => {
      const action = args.action as string;
      const senderId = args.sender_id as string | undefined;

      switch (action) {
        case 'list_pending': {
          const pending = accessControl.listPending(agentId);
          if (pending.length === 0) {
            return { content: [{ type: 'text', text: 'No pending access requests.' }] };
          }
          return {
            content: [{ type: 'text', text: `Pending: ${pending.join(', ')}` }],
          };
        }

        case 'list_approved': {
          const approved = accessControl.listApproved(agentId);
          if (approved.length === 0) {
            return { content: [{ type: 'text', text: 'No approved users (only allowlist).' }] };
          }
          return {
            content: [{ type: 'text', text: `Approved: ${approved.join(', ')}` }],
          };
        }

        case 'approve': {
          if (!senderId) {
            return {
              content: [{ type: 'text', text: 'sender_id is required for approve action.' }],
              isError: true,
            };
          }
          const ok = accessControl.approveManually(agentId, senderId);
          if (ok) {
            return { content: [{ type: 'text', text: `Approved: ${senderId}` }] };
          }
          accessControl.forceApprove(agentId, senderId);
          return { content: [{ type: 'text', text: `Force-approved: ${senderId} (was not in pending)` }] };
        }

        case 'revoke': {
          if (!senderId) {
            return {
              content: [{ type: 'text', text: 'sender_id is required for revoke action.' }],
              isError: true,
            };
          }
          const revoked = accessControl.revoke(agentId, senderId);
          return {
            content: [{
              type: 'text',
              text: revoked ? `Revoked: ${senderId}` : `${senderId} was not in approved list.`,
            }],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown action: ${action}` }],
            isError: true,
          };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

export const META: ToolMeta = {
  category: 'agent-config',
  safe_in_public: false, safe_in_trusted: false, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: ['public', 'trusted'],
};

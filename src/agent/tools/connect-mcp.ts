import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';
import type { createOnboarding } from '../../integrations/mcp-onboarding/index.js';
import type { Requester } from '../../integrations/mcp-onboarding/types.js';

type OnboardingFacade = ReturnType<typeof createOnboarding>;

/**
 * Per-dispatch context for the `connect_mcp` tool. The Gateway rebuilds the
 * agent's MCP server per dispatch (see `buildUserQueryOptions` in
 * `gateway.ts`) and substitutes in a context-aware version of this tool so
 * the facade can route the OAuth callback / apikey URL back into the right
 * chat session.
 *
 * - `agentSessionKey`: the synthetic message dispatch target (`{agentId}:
 *   {channel}:{chatType}:{peerId}[...]`). Required to receive a `[system]
 *   mcp_connected` follow-up — without it the facade treats the call as
 *   admin-initiated and produces no chat dispatch on completion.
 * - `chatType`: maps the channel-layer concept (`'dm' | 'group'`) to the
 *   facade's wider taxonomy (`'private' | 'group' | 'supergroup' |
 *   'channel'`). Used solely to enforce the DM-only guard.
 */
export interface ConnectMcpDispatchContext {
  agentSessionKey?: string;
  chatType?: Requester['chatType'];
}

const OAUTH_AUTHORIZE_MESSAGE
  = 'Forward this auth URL to the user. After they click and authorize '
  + 'you will receive a [system] mcp_connected: <serverId> message in this '
  + 'session. Do not poll unless the user explicitly asks for status.';

const APIKEY_MESSAGE
  = 'Forward the apikeyUrl to the user. The user opens it, pastes their '
  + 'API key, and you will receive a [system] mcp_connected: <serverId> '
  + 'message.';

const REQUIRES_DM_MESSAGE
  = 'Tell the user: "Setting up MCP servers requires a private chat. '
  + 'Please message me directly to continue."';

const inputSchema = {
  op: z
    .enum(['connect', 'apikey', 'finalize', 'check', 'cancel'])
    .describe(
      'Operation: connect (start a new flow), apikey (attach a token to an '
      + 'awaiting_apikey pending), finalize (commit allowed_tools after a '
      + '[system] mcp_connected), check (poll status by pendingId), cancel '
      + '(abort a pending row).',
    ),
  url: z
    .string()
    .url()
    .optional()
    .describe('MCP server URL — required for op=connect.'),
  pendingId: z
    .string()
    .optional()
    .describe(
      'Pending-row id returned by op=connect. Required for op=apikey / '
      + 'finalize / check / cancel.',
    ),
  token: z
    .string()
    .optional()
    .describe('API key / bearer token — required for op=apikey.'),
  allowed_tools: z
    .array(z.string())
    .optional()
    .describe(
      'Tool names to expose to the agent. Use `["*"]` to allow every tool '
      + 'the server advertises. Required for op=finalize.',
    ),
};

/**
 * Built-in tool: connect an external MCP server from chat. One discriminated-
 * union surface covering the five operations of the onboarding lifecycle.
 *
 * - `connect`: probe the URL → return either an OAuth `authUrl` (the user
 *   clicks, authorizes, the gateway emits `[system] mcp_connected`) or an
 *   `apikeyUrl` (the user pastes a token at a pending-id-scoped page).
 * - `apikey`: attach a token to an `awaiting_apikey` pending — used when
 *   the agent collected the token in-chat directly rather than via the
 *   wizard page.
 * - `finalize`: after a completion event, commit the chosen tool subset to
 *   the agent's `external_mcp_servers` block.
 * - `check`: poll a pending row's status / age / TTL — agents should NOT
 *   call this on a schedule; the gateway dispatches `[system]
 *   mcp_connected|mcp_connect_failed|mcp_connect_timeout` so the agent
 *   only needs `check` for ad-hoc "is it still going?" questions.
 * - `cancel`: abort a pending row the user no longer wants.
 *
 * Always registered for every agent: the tool is harmless without an
 * active pending and the chat-side guards (DM-only, agent context) live
 * in the facade.
 */
export function createConnectMcpTool(
  agentId: string,
  getFacade: () => OnboardingFacade,
  getDispatchContext?: () => ConnectMcpDispatchContext | undefined,
): ToolDefinition {
  const sdkTool = tool(
    'connect_mcp',
    'Connect an external MCP server (OAuth or API-key) on behalf of the user. '
      + 'Walks through: connect → (authorize | enter token) → finalize. '
      + 'On completion the gateway delivers a `[system] mcp_connected: '
      + '<serverId>` message into this session — do NOT poll for status '
      + 'unless the user explicitly asks. DM-only: refuses with a clear '
      + 'message when called from a group.',
    inputSchema,
    async (args: Record<string, unknown>) => {
      const op = args.op as 'connect' | 'apikey' | 'finalize' | 'check' | 'cancel';
      const facade = getFacade();
      const ctx = getDispatchContext?.() ?? undefined;

      try {
        if (op === 'connect') {
          const url = args.url as string | undefined;
          if (!url) {
            return errorResult('op=connect requires `url`');
          }
          const requester: Requester = {
            kind: 'agent',
            agentId,
            ...(ctx?.agentSessionKey ? { agentSessionKey: ctx.agentSessionKey } : {}),
            ...(ctx?.chatType ? { chatType: ctx.chatType } : {}),
          };
          const res = await facade.startConnection({ url, requester });
          const message = pickConnectMessage(res);
          return jsonResult({ ...res, message });
        }

        if (op === 'apikey') {
          const pendingId = args.pendingId as string | undefined;
          const token = args.token as string | undefined;
          if (!pendingId || !token) {
            return errorResult('op=apikey requires `pendingId` and `token`');
          }
          const res = await facade.attachApiKey({ pendingId, token });
          return jsonResult(res);
        }

        if (op === 'finalize') {
          const pendingId = args.pendingId as string | undefined;
          const allowed = args.allowed_tools as string[] | undefined;
          if (!pendingId || !Array.isArray(allowed)) {
            return errorResult(
              'op=finalize requires `pendingId` and `allowed_tools`',
            );
          }
          const res = await facade.finalize({
            pendingId,
            allowed_tools: allowed,
          });
          return jsonResult(res);
        }

        if (op === 'check') {
          const pendingId = args.pendingId as string | undefined;
          if (!pendingId) {
            return errorResult('op=check requires `pendingId`');
          }
          const row = facade.getPending(pendingId);
          if (!row) return jsonResult({ status: 'not_found' });
          return jsonResult(row);
        }

        if (op === 'cancel') {
          const pendingId = args.pendingId as string | undefined;
          if (!pendingId) {
            return errorResult('op=cancel requires `pendingId`');
          }
          return jsonResult(facade.cancel(pendingId));
        }

        return errorResult(`connect_mcp: unknown op "${String(op)}"`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

function pickConnectMessage(res: {
  status: string;
  reason?: string;
}): string {
  if (res.status === 'authorize') return OAUTH_AUTHORIZE_MESSAGE;
  if (res.status === 'awaiting_apikey') return APIKEY_MESSAGE;
  if (res.status === 'rejected' && res.reason === 'mcp_onboarding_requires_dm') {
    return REQUIRES_DM_MESSAGE;
  }
  if (res.status === 'rejected') {
    return `Tell the user the MCP connection could not be started: ${
      res.reason ?? 'unknown'
    }.`;
  }
  return '';
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const,
  };
}

export const META: ToolMeta = {
  // Writes a new `external_mcp_servers` entry to `agent.yml` on finalize,
  // so this is fundamentally an agent-config mutation surface.
  category: 'agent-config',
  safe_in_public: false,
  safe_in_trusted: true,
  safe_in_private: true,
  destructive: false,
  reads_only: false,
  hard_blacklist_in: [],
};

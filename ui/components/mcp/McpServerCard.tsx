import { ReauthBanner } from './ReauthBanner';

/**
 * Compact card representation of a single configured external MCP server.
 *
 * Status semantics:
 *   - `connected`:        token healthy, server reachable
 *   - `refreshing`:       pre-flight refresh in progress
 *   - `reauth_required`:  credential.metadata.needs_reauth = '1' (banner shown)
 *   - `disabled`:         agent toggle off / server temporarily skipped
 *
 * Phase 7 wires this into the agent config page; for Phase 6 it lives in
 * isolation with unit-test coverage.
 */
export interface McpServerCardProps {
  name: string;
  url: string;
  transport: 'http' | 'sse' | 'stdio';
  toolCount: number;
  status: 'connected' | 'refreshing' | 'reauth_required' | 'disabled';
  tokenExpiresAt?: number;
  onEditAllowed: () => void;
  onReauth: () => void;
  onRemove: () => void;
}

const DOT_COLOR: Record<McpServerCardProps['status'], string> = {
  connected: 'bg-green-500',
  refreshing: 'bg-yellow-500',
  reauth_required: 'bg-orange-500',
  disabled: 'bg-zinc-400',
};

export function McpServerCard(p: McpServerCardProps) {
  const dotColor = DOT_COLOR[p.status];
  const tooltip = p.tokenExpiresAt
    ? `Connected · expires ${new Date(p.tokenExpiresAt).toLocaleString()}`
    : p.status;
  return (
    <div className="border rounded-lg p-3 space-y-1">
      {p.status === 'reauth_required' && (
        <ReauthBanner serverName={p.name} onReauth={p.onReauth} />
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            data-testid="mcp-server-card-status-dot"
            className={`w-2 h-2 rounded-full ${dotColor}`}
            title={tooltip}
          />
          <span className="font-medium">{p.name}</span>
          <span className="text-xs text-zinc-500">
            {p.transport} · {p.toolCount} tools
          </span>
        </div>
      </div>
      <p className="text-xs text-zinc-500">{p.url}</p>
      <div className="flex gap-2 text-sm">
        <button type="button" onClick={p.onEditAllowed} className="underline">
          Edit allowed tools
        </button>
        <button type="button" onClick={p.onReauth} className="underline">
          Re-auth
        </button>
        <button
          type="button"
          onClick={p.onRemove}
          className="underline text-red-600"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

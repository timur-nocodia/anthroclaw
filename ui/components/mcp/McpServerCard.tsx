import { ReauthBanner } from './ReauthBanner';
import { Button } from '@/components/ui/button';

/**
 * Compact card representation of a single configured external MCP server.
 *
 * Status semantics:
 *   - `connected`:        token healthy, server reachable
 *   - `refreshing`:       pre-flight refresh in progress
 *   - `reauth_required`:  credential.metadata.needs_reauth = '1' (banner shown)
 *   - `disabled`:         agent toggle off / server temporarily skipped
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
  connected: 'bg-emerald-500',
  refreshing: 'bg-amber-500',
  reauth_required: 'bg-orange-500',
  disabled: 'bg-muted-foreground/50',
};

export function McpServerCard(p: McpServerCardProps) {
  const dotColor = DOT_COLOR[p.status];
  const tooltip = p.tokenExpiresAt
    ? `Connected · expires ${new Date(p.tokenExpiresAt).toLocaleString()}`
    : p.status;
  return (
    <div className="rounded-lg border bg-card text-card-foreground p-3 space-y-2">
      {p.status === 'reauth_required' && (
        <ReauthBanner serverName={p.name} onReauth={p.onReauth} />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            data-testid="mcp-server-card-status-dot"
            className={`size-2 shrink-0 rounded-full ${dotColor}`}
            title={tooltip}
          />
          <span className="font-medium truncate">{p.name}</span>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {p.transport} · {p.toolCount} tools
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground truncate font-mono">{p.url}</p>
      <div className="flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" onClick={p.onEditAllowed}>
          Edit allowed tools
        </Button>
        <Button variant="ghost" size="sm" onClick={p.onReauth}>
          Re-auth
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={p.onRemove}
          className="text-destructive hover:text-destructive"
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

import { Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { ReauthBanner } from './ReauthBanner';

/**
 * Compact card representation of a single configured external MCP server.
 *
 * Styled to match the inline-card pattern used elsewhere in ConfigTab
 * (quick commands, cron jobs) — `var(--oc-bg2)` panel with
 * `var(--oc-border)` outline, `var(--oc-mono)` URL text, and lightweight
 * icon-text action buttons that hover to `var(--oc-bg3)`.
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

const DOT_VAR: Record<McpServerCardProps['status'], string> = {
  connected: 'var(--oc-green, #22c55e)',
  refreshing: 'var(--oc-yellow, #eab308)',
  reauth_required: 'var(--oc-orange, #f97316)',
  disabled: 'var(--oc-text-dim, #6b7280)',
};

export function McpServerCard(p: McpServerCardProps) {
  const tooltip = p.tokenExpiresAt
    ? `Connected · expires ${new Date(p.tokenExpiresAt).toLocaleString()}`
    : p.status;
  return (
    <div
      className="flex flex-col gap-2 rounded-[5px] border p-2.5"
      style={{
        borderColor: 'var(--oc-border)',
        background: 'var(--oc-bg2)',
      }}
    >
      {p.status === 'reauth_required' && (
        <ReauthBanner serverName={p.name} onReauth={p.onReauth} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="mcp-server-card-status-dot"
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: DOT_VAR[p.status] }}
          title={tooltip}
        />
        <span
          className="text-[12.5px] font-medium"
          style={{ color: 'var(--color-foreground)' }}
        >
          {p.name}
        </span>
        <span
          className="text-[11px]"
          style={{ color: 'var(--oc-text-muted)' }}
        >
          {p.transport} · {p.toolCount} {p.toolCount === 1 ? 'tool' : 'tools'}
        </span>
      </div>
      <p
        className="truncate text-[11px]"
        style={{
          color: 'var(--oc-text-muted)',
          fontFamily: 'var(--oc-mono)',
        }}
      >
        {p.url}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <CardActionButton onClick={p.onEditAllowed} icon={<Pencil className="h-3 w-3" />}>
          Edit allowed tools
        </CardActionButton>
        <CardActionButton onClick={p.onReauth} icon={<RefreshCw className="h-3 w-3" />}>
          Re-auth
        </CardActionButton>
        <CardActionButton
          onClick={p.onRemove}
          icon={<Trash2 className="h-3 w-3" />}
          danger
        >
          Remove
        </CardActionButton>
      </div>
    </div>
  );
}

function CardActionButton({
  onClick,
  icon,
  danger,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-[11px] transition-colors hover:bg-[var(--oc-bg3)]"
      style={{
        color: danger ? 'var(--oc-red, #ef4444)' : 'var(--oc-text-muted)',
      }}
    >
      {icon}
      {children}
    </button>
  );
}

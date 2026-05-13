import { AlertTriangle } from 'lucide-react';

/**
 * Inline warning banner shown when an MCP server's stored token has been
 * revoked or refresh-failed (credential.metadata.needs_reauth === '1').
 *
 * Uses the same `var(--oc-yellow)` accent the dirty-config pill in
 * ConfigTab uses so warnings read consistently across the agent page.
 */
export interface ReauthBannerProps {
  serverName: string;
  onReauth: () => void;
}

export function ReauthBanner({ serverName, onReauth }: ReauthBannerProps) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-[4px] border px-2.5 py-1.5 text-[11.5px]"
      style={{
        borderColor: 'var(--oc-yellow, #eab308)',
        background:
          'color-mix(in srgb, var(--oc-yellow, #eab308) 12%, transparent)',
        color: 'var(--color-foreground)',
      }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <AlertTriangle
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: 'var(--oc-yellow, #eab308)' }}
          aria-hidden
        />
        <span className="truncate">
          Token for <strong className="font-medium">{serverName}</strong>{' '}
          expired — re-authorize
        </span>
      </div>
      <button
        type="button"
        onClick={onReauth}
        className="inline-flex items-center rounded-[4px] px-2 py-1 text-[11px] transition-colors hover:bg-[var(--oc-bg3)]"
        style={{ color: 'var(--oc-yellow, #eab308)' }}
      >
        Re-authorize
      </button>
    </div>
  );
}

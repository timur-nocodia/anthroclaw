import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Inline banner shown when an MCP server's stored token has been revoked
 * or refresh-failed (credential.metadata.needs_reauth === '1').
 */
export interface ReauthBannerProps {
  serverName: string;
  onReauth: () => void;
}

export function ReauthBanner({ serverName, onReauth }: ReauthBannerProps) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="size-4 shrink-0 text-amber-500" aria-hidden />
        <span className="truncate">
          Token for <strong className="font-medium">{serverName}</strong> expired — re-authorize
        </span>
      </div>
      <Button size="sm" variant="outline" onClick={onReauth} className="border-amber-500/40">
        Re-authorize
      </Button>
    </div>
  );
}

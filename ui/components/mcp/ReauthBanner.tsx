/**
 * Inline amber banner shown when an MCP server's stored token has been
 * revoked or refresh-failed (credential.metadata.needs_reauth === '1').
 *
 * Rendered inside `McpServerCard` when status === 'reauth_required', and
 * standalone elsewhere in the future if we want to surface re-auth prompts
 * at the top of a page.
 */
export interface ReauthBannerProps {
  serverName: string;
  onReauth: () => void;
}

export function ReauthBanner({ serverName, onReauth }: ReauthBannerProps) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-md p-2 flex items-center justify-between text-sm">
      <span>
        ⚠ Token for <strong>{serverName}</strong> expired — re-authorize
      </span>
      <button
        type="button"
        onClick={onReauth}
        className="bg-amber-600 text-white px-2 py-1 rounded"
      >
        Re-authorize
      </button>
    </div>
  );
}

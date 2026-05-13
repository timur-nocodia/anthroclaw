/**
 * Chat-path landing page shown after a successful OAuth round-trip. The
 * Gateway dispatches a `[system] mcp_connected: <serverId>` synthetic
 * message into the originating session so the agent can confirm directly
 * in chat — this page exists only to give the browser tab somewhere to
 * land.
 */
import { CheckCircle2 } from 'lucide-react';

export default function McpDonePage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-3 text-center">
        <CheckCircle2 className="size-10 mx-auto text-emerald-500" aria-hidden />
        <h1 className="text-xl font-medium">Done</h1>
        <p className="text-sm text-muted-foreground">
          You can close this tab. The agent will confirm in chat.
        </p>
      </div>
    </main>
  );
}

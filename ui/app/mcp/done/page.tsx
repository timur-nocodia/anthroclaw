/**
 * Minimal landing page shown to chat-initiated users after a successful
 * OAuth round-trip. Phase 5 will replace this with a richer "Connected!"
 * confirmation including the next step the agent will perform.
 */
export default function McpDonePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-3 text-center">
        <h1 className="text-2xl font-medium">MCP server connected</h1>
        <p className="text-sm text-neutral-600">
          You can close this tab and return to your chat. The agent will pick
          up the new tools on its next reply.
        </p>
      </div>
    </main>
  );
}

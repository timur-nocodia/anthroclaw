/**
 * Landing page after the user denied consent at the provider's OAuth screen
 * (callback received `?error=...`). Pure server component — pulls the reason
 * from the search params so the user sees what happened.
 */
import { XCircle } from 'lucide-react';

export default async function McpCancelledPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-3 text-center">
        <XCircle className="size-10 mx-auto text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-medium">Connection cancelled</h1>
        <p className="text-sm text-muted-foreground">
          The MCP server connection was not completed.
          {reason ? (
            <> Reason: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{reason}</code>.</>
          ) : null}
        </p>
      </div>
    </main>
  );
}

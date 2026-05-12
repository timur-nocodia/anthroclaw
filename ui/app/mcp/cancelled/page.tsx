/**
 * Landing page after the user denied consent at the provider's OAuth screen
 * (callback received `?error=...`). Pure server component — pulls the reason
 * from the search params so the user sees what happened.
 */
export default async function McpCancelledPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-3 text-center">
        <h1 className="text-2xl font-medium">Connection cancelled</h1>
        <p className="text-sm text-neutral-600">
          The MCP server connection was not completed.
          {reason ? <> Reason: <code>{reason}</code>.</> : null}
        </p>
      </div>
    </main>
  );
}

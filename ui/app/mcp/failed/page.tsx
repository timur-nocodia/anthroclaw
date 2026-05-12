/**
 * Landing page after `completeOAuth` failed (token-exchange error,
 * malformed metadata, etc.). Pure server component.
 */
export default async function McpFailedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-3 text-center">
        <h1 className="text-2xl font-medium">Connection failed</h1>
        <p className="text-sm text-neutral-600">
          Something went wrong completing the OAuth flow.
          {reason ? <> Reason: <code>{reason}</code>.</> : null}
        </p>
        <p className="text-sm text-neutral-600">
          Try starting again from the wizard.
        </p>
      </div>
    </main>
  );
}

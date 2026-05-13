/**
 * Landing page after `completeOAuth` failed (token-exchange error,
 * malformed metadata, etc.). Pure server component.
 */
import { AlertCircle } from 'lucide-react';

export default async function McpFailedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-3 text-center">
        <AlertCircle className="size-10 mx-auto text-destructive" aria-hidden />
        <h1 className="text-xl font-medium">Connection failed</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong completing the OAuth flow.
          {reason ? (
            <> Reason: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{reason}</code>.</>
          ) : null}
        </p>
        <p className="text-sm text-muted-foreground">
          Try starting again from the wizard.
        </p>
      </div>
    </main>
  );
}

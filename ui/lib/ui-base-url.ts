/**
 * Resolve the externally-visible UI base URL.
 *
 * The MCP onboarding flow generates one-shot links (apikey paste page, OAuth
 * authorize redirects) that are surfaced into chat or rendered by the wizard.
 * Both need to point at the URL the operator can actually open — not the
 * Next.js dev server's localhost — so we read it from explicit env config
 * rather than guessing from request headers (Telegram-initiated flows have
 * no incoming HTTP request at link-generation time).
 *
 * Resolution order:
 *   1. `UI_BASE_URL` — explicit, takes precedence.
 *   2. `NEXT_PUBLIC_BASE_URL` — already used elsewhere in the UI as the
 *      canonical public URL; allow reuse so operators don't have to set two
 *      env vars saying the same thing.
 *
 * Throws if neither is set so misconfiguration fails loud at link-generation
 * time rather than silently producing `undefined/mcp/connect/...` URLs.
 */

export function getUiBaseUrl(): string {
  const explicit = process.env.UI_BASE_URL;
  if (explicit && explicit.length > 0) return explicit.replace(/\/$/, '');
  const publicBase = process.env.NEXT_PUBLIC_BASE_URL;
  if (publicBase && publicBase.length > 0) return publicBase.replace(/\/$/, '');
  throw new Error(
    'UI_BASE_URL (or NEXT_PUBLIC_BASE_URL) must be configured to generate MCP onboarding links',
  );
}

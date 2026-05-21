/**
 * Next.js instrumentation hook — runs once when the server boots, before
 * the first request. We use it to eagerly start the Gateway runtime
 * (Telegram polling, WhatsApp polling, cron scheduler, agent loading) so
 * the bot is responsive immediately after `docker compose up -d`.
 *
 * Why this exists: `ui/lib/gateway.ts` is a lazy singleton — the runtime
 * only boots when the first API route calls `getGateway()`. In practice
 * that means the bot is silent on Telegram/WhatsApp after a container
 * restart until somebody loads the admin UI and an authenticated API
 * call wakes the singleton. After the v1.1.3 rebuild, prod went silent
 * for ~6 minutes because no UI session was open to trigger boot.
 *
 * Only registers in the Node.js server runtime — Next.js also calls
 * this in the Edge runtime, where most of our gateway imports would
 * fail.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'production') return;

  // Use a static `import()` so webpack bundles `./lib/gateway` (and its
  // transitive deps) into a server chunk at build time. The previous
  // `new Function('modulePath', 'return import(modulePath)')` form was
  // designed to bypass webpack's static analysis, but it leaves nothing
  // bundled at `.next/server/lib/gateway` and Next.js then crashes the
  // server with `ERR_MODULE_NOT_FOUND` before the lazy-boot path can
  // even retry — taking the admin UI down with it.
  try {
    const { getGateway } = await import('./lib/gateway');
    await getGateway();
  } catch (err) {
    // Don't crash the Next.js server on gateway boot failure — log and
    // let the lazy path retry on the next API call. A hard crash would
    // take down the admin UI, removing the operator's only way to
    // diagnose the failure.
    // eslint-disable-next-line no-console
    console.error('[instrumentation] Gateway boot failed:', err);
  }
}

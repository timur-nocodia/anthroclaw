import { NextRequest } from 'next/server';
import { requireAuth, handleAuthError } from '@/lib/require-auth';
import { subscribeToLogs } from '@/lib/log-buffer';

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  const { searchParams } = req.nextUrl;
  const level = searchParams.get('level') ?? undefined;
  const source = searchParams.get('source') ?? undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'));

      const unsubscribe = subscribeToLogs(
        (entry) => {
          try {
            const json = JSON.stringify(entry);
            controller.enqueue(encoder.encode(`data: ${json}\n\n`));
          } catch {
            // Skip encoding errors
          }
        },
        { level, source },
      );

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 30000);

      req.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

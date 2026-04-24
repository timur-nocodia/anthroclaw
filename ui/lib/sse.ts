/**
 * Creates an SSE (Server-Sent Events) Response from an async handler.
 *
 * The handler receives `send` and `close` callbacks.
 * Each call to `send(data)` writes `data: {json}\n\n` to the stream.
 * Calling `close()` terminates the stream.
 */
export function createSSEStream(
  handler: (send: (data: unknown) => void, close: () => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          const json = JSON.stringify(data);
          controller.enqueue(encoder.encode(`data: ${json}\n\n`));
        } catch {
          // If encoding fails, skip the event
        }
      };

      const close = () => {
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      handler(send, close).catch((err) => {
        try {
          const errJson = JSON.stringify({ type: 'error', message: String(err) });
          controller.enqueue(encoder.encode(`data: ${errJson}\n\n`));
          controller.close();
        } catch {
          // Stream already closed
        }
      });
    },
    cancel() {
      // Stream consumer disconnected; no cleanup needed
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

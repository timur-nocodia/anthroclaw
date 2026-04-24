import { NextRequest } from 'next/server';
import { requireAuth, handleAuthError } from '@/lib/require-auth';
import { proxyRequest } from '@/lib/fleet-proxy';

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string; path: string[] }> },
) {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  const { serverId, path: pathSegments } = await params;
  const apiPath = pathSegments.join('/');

  const forwardHeaders: Record<string, string> = {};
  const isLocal = serverId === 'local';
  req.headers.forEach((value, key) => {
    const skip = ['host', 'authorization'];
    if (!isLocal) skip.push('cookie');
    if (!skip.includes(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  });

  const body = ['GET', 'HEAD'].includes(req.method)
    ? null
    : await req.text();

  let response: Response;
  try {
    response = await proxyRequest(
      serverId,
      apiPath,
      req.method,
      forwardHeaders,
      body,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy error';
    if (message === 'server_not_found') {
      return Response.json({ error: 'server_not_found' }, { status: 404 });
    }
    return Response.json(
      { error: 'proxy_error', message },
      { status: 502 },
    );
  }

  // Pass through SSE streams
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  // Regular response — pass through status + content-type
  const data = await response.text();
  return new Response(data, {
    status: response.status,
    headers: {
      'Content-Type': contentType || 'application/json',
    },
  });
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE };

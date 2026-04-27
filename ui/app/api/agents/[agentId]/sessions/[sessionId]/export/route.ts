import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';
import { formatSessionMarkdown } from '@/lib/export-session';
import type { StoredSessionEntry } from '@/lib/normalize-session';

const FORMATS = new Set(['jsonl', 'md']);

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'session';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; sessionId: string }> },
) {
  return withAuth(async () => {
    const { agentId, sessionId } = await params;
    const decoded = decodeURIComponent(sessionId);
    const url = new URL(req.url);
    const format = url.searchParams.get('format') ?? 'md';

    if (!FORMATS.has(format)) {
      return NextResponse.json(
        { error: 'invalid_format', message: 'format must be one of: jsonl, md' },
        { status: 400 },
      );
    }

    const gw = await getGateway();
    const details = await gw.getAgentSessionDetails(agentId, decoded, {
      includeSystemMessages: true,
      limit: 10_000,
    });

    const baseName = safeFilename(`${agentId}-${decoded}`);

    if (format === 'jsonl') {
      const lines = details.messages
        .map((m) => JSON.stringify({ type: m.type, uuid: m.uuid, sessionId: m.sessionId, message: m.message }))
        .join('\n');
      return new NextResponse(lines + (lines.length > 0 ? '\n' : ''), {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}.jsonl"`,
        },
      });
    }

    const stored: StoredSessionEntry[] = details.messages.map((m, i) => ({
      type: m.type,
      uuid: m.uuid || `${details.sessionId}-${i}`,
      text: m.text,
      message: m.message,
    }));
    const md = formatSessionMarkdown(stored, {
      sessionId: details.sessionId,
      title: details.summary,
      lastModified: details.lastModified,
    });

    return new NextResponse(md, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseName}.md"`,
      },
    });
  });
}

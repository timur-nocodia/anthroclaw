import { NextResponse } from 'next/server';
import { z } from 'zod';
import { probe } from '@backend/integrations/mcp-onboarding/probe.js';

/**
 * Probe an MCP server URL and return its classification.
 *
 * Public — no admin auth. The probe is a single unauthenticated POST to the
 * declared URL and reveals only what the URL itself reveals; rate-limiting
 * lives at the edge layer above the Next.js handler.
 */

const Body = z.object({ url: z.string().url() });

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
  }
  const result = await probe(parsed.data.url);
  return NextResponse.json(result);
}

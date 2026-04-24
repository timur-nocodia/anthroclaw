import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { loadFleet, addServer, ensureLocalServer } from '@/lib/fleet';
import type { FleetServer } from '@/lib/fleet';

export async function GET() {
  return withAuth(async () => {
    ensureLocalServer();
    return NextResponse.json(loadFleet());
  });
}

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json();
    const { id, name, url, apiKey, environment, region, city, tags } = body as Partial<FleetServer>;

    if (!id || !name || !url || !apiKey || !environment || !region) {
      return NextResponse.json(
        { error: 'validation_error', message: 'Missing required fields: id, name, url, apiKey, environment, region' },
        { status: 400 },
      );
    }

    const server: FleetServer = {
      id,
      name,
      url,
      apiKey,
      environment,
      region,
      city,
      tags: tags ?? [],
    };

    try {
      addServer(server);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add server';
      return NextResponse.json({ error: 'conflict', message }, { status: 409 });
    }

    return NextResponse.json({ id }, { status: 201 });
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getServer, updateServer, removeServer } from '@/lib/fleet';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  return withAuth(async () => {
    const { serverId } = await params;
    const server = getServer(serverId);
    if (!server) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(server);
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  return withAuth(async () => {
    const { serverId } = await params;
    const body = await req.json();

    const server = getServer(serverId);
    if (!server) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // Only allow patching safe fields
    const { city, environment, region, tags, primary } = body;
    const patch: Record<string, unknown> = {};
    if (city !== undefined) patch.city = city;
    if (environment !== undefined) patch.environment = environment;
    if (region !== undefined) patch.region = region;
    if (tags !== undefined) patch.tags = tags;
    if (primary !== undefined) patch.primary = primary;

    updateServer(serverId, patch);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  return withAuth(async () => {
    const { serverId } = await params;

    const server = getServer(serverId);
    if (!server) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    removeServer(serverId);
    return NextResponse.json({ ok: true });
  });
}

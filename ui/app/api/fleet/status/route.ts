import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { fetchFleetStatus, type FleetStatus } from '@/lib/fleet';
import { evaluateAlerts } from '@/lib/fleet-alerts';

const CACHE_TTL_MS = Number.parseInt(process.env.FLEET_STATUS_CACHE_TTL_MS ?? '5000', 10);
const STALE_TTL_MS = Number.parseInt(process.env.FLEET_STATUS_STALE_TTL_MS ?? '30000', 10);

let cachedStatus: { value: FleetStatus; updatedAt: number } | null = null;
let inflightStatus: Promise<FleetStatus> | null = null;

function cacheMs(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function refreshFleetStatus(): Promise<FleetStatus> {
  if (!inflightStatus) {
    inflightStatus = fetchFleetStatus()
      .then((status) => {
        evaluateAlerts(status.servers);
        cachedStatus = { value: status, updatedAt: Date.now() };
        return status;
      })
      .finally(() => {
        inflightStatus = null;
      });
  }
  return inflightStatus;
}

async function getFleetStatusCached(): Promise<FleetStatus> {
  const now = Date.now();
  const freshFor = cacheMs(CACHE_TTL_MS, 5000);
  const staleFor = cacheMs(STALE_TTL_MS, 30000);

  if (cachedStatus && now - cachedStatus.updatedAt <= freshFor) {
    return cachedStatus.value;
  }

  if (cachedStatus && now - cachedStatus.updatedAt <= staleFor) {
    void refreshFleetStatus().catch(() => undefined);
    return cachedStatus.value;
  }

  return refreshFleetStatus();
}

export async function GET() {
  return withAuth(async () => {
    const status = await getFleetStatusCached();
    return NextResponse.json(status);
  });
}

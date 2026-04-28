import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { resolve } from 'node:path';
import { NotFoundError } from '@/lib/agents';
import { getGateway } from '@/lib/gateway';
import {
  getOverlayPath,
  readBaseConfigRaw,
  readRuntimeOverlay,
  writeRuntimeOverlay,
} from '@backend/config/overlay.js';

const CONFIG_PATH = resolve(process.cwd(), '..', 'config.yml');
const OVERLAY_PATH = getOverlayPath(resolve(process.cwd(), '..', 'data'));

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  return withAuth(async () => {
    const { accountId } = await params;

    const gw = await getGateway();
    const cfg = gw.getGlobalConfig();
    const inLiveConfig = !!cfg?.whatsapp?.accounts?.[accountId];

    const base = readBaseConfigRaw(CONFIG_PATH);
    const baseAccounts =
      (base.whatsapp as { accounts?: Record<string, unknown> } | undefined)?.accounts ?? {};
    const inBaseConfig = accountId in baseAccounts;

    const overlay = readRuntimeOverlay(OVERLAY_PATH);
    const overlayWa = (overlay.whatsapp as { accounts?: Record<string, unknown> } | undefined) ?? {};
    const overlayAccounts = overlayWa.accounts ?? {};
    const inOverlay = accountId in overlayAccounts && overlayAccounts[accountId] !== null;

    if (!inLiveConfig && !inBaseConfig && !inOverlay) {
      throw new NotFoundError(accountId);
    }

    if (inLiveConfig) {
      await gw.disconnectWhatsAppAccount(accountId);
    }

    // Persist removal to the overlay so it survives gateway restart.
    // - If account exists in base: write a null tombstone.
    // - If account only lived in overlay: drop the overlay entry.
    const nextAccounts: Record<string, unknown> = { ...overlayAccounts };
    if (inBaseConfig) {
      nextAccounts[accountId] = null;
    } else {
      delete nextAccounts[accountId];
    }

    const nextOverlay: Record<string, unknown> = { ...overlay };
    if (Object.keys(nextAccounts).length === 0) {
      const wa = { ...overlayWa };
      delete wa.accounts;
      if (Object.keys(wa).length === 0) {
        delete nextOverlay.whatsapp;
      } else {
        nextOverlay.whatsapp = wa;
      }
    } else {
      nextOverlay.whatsapp = { ...overlayWa, accounts: nextAccounts };
    }

    writeRuntimeOverlay(OVERLAY_PATH, nextOverlay);

    return NextResponse.json({ ok: true });
  });
}

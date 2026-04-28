import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { NotFoundError } from '@/lib/agents';
import { getGateway } from '@/lib/gateway';

const CONFIG_PATH = resolve(process.cwd(), '..', 'config.yml');

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  return withAuth(async () => {
    const { accountId } = await params;

    const gw = await getGateway();
    const cfg = gw.getGlobalConfig();
    const inLiveConfig = !!cfg?.whatsapp?.accounts?.[accountId];

    let inFileConfig = false;
    let fileConfig: Record<string, unknown> | null = null;
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, 'utf-8');
      fileConfig = parseYaml(raw) as Record<string, unknown>;
      const accounts = (fileConfig?.whatsapp as { accounts?: Record<string, unknown> } | undefined)
        ?.accounts;
      inFileConfig = !!accounts && accountId in accounts;
    }

    if (!inLiveConfig && !inFileConfig) {
      throw new NotFoundError(accountId);
    }

    if (inLiveConfig) {
      await gw.disconnectWhatsAppAccount(accountId);
    }

    if (inFileConfig && fileConfig) {
      const wa = fileConfig.whatsapp as { accounts?: Record<string, unknown> } | undefined;
      if (wa?.accounts) {
        delete wa.accounts[accountId];
        if (Object.keys(wa.accounts).length === 0) {
          delete wa.accounts;
        }
      }
      if (wa && Object.keys(wa).length === 0) {
        delete fileConfig.whatsapp;
      }
      writeFileSync(CONFIG_PATH, stringifyYaml(fileConfig), 'utf-8');
    }

    return NextResponse.json({ ok: true });
  });
}

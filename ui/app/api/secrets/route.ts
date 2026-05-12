import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import {
  deleteSecretSync,
  listSecretsSync,
  setSecretSync,
} from '@backend/secrets/vault.js';
import type { SecretScope } from '@backend/secrets/ref.js';

const SCOPES = new Set(['global', 'agent', 'fleet']);

interface SecretBody {
  scope?: SecretScope;
  ownerId?: string;
  service?: string;
  key?: string;
  label?: string;
  value?: string;
  ref?: string;
}
export async function GET(req: NextRequest) {
  return withAuth(async () => {
    try {
      const scope = req.nextUrl.searchParams.get('scope') as SecretScope | null;
      const ownerId = req.nextUrl.searchParams.get('ownerId') ?? undefined;
      if (scope && !SCOPES.has(scope)) {
        return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
      }
      const secrets = listSecretsSync({
        scope: scope ?? undefined,
        ownerId,
      });
      return NextResponse.json({ secrets });
    } catch (err) {
      return secretErrorResponse(err);
    }
  });
}

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    let body: SecretBody;
    try {
      body = (await req.json()) as SecretBody;
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const scope = body.scope;
    if (!scope || !SCOPES.has(scope)) {
      return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
    }
    if (!body.service || !body.key || !body.value) {
      return NextResponse.json(
        { error: 'validation_error', message: 'scope, service, key, and value are required' },
        { status: 400 },
      );
    }
    if (scope !== 'global' && !body.ownerId) {
      return NextResponse.json(
        { error: 'validation_error', message: 'ownerId is required for agent and fleet secrets' },
        { status: 400 },
      );
    }

    try {
      const secret = setSecretSync({
        scope,
        ownerId: body.ownerId,
        service: body.service,
        key: body.key,
        label: body.label,
        value: body.value,
      });
      return NextResponse.json({ secret });
    } catch (err) {
      return secretErrorResponse(err);
    }
  });
}

export async function DELETE(req: NextRequest) {
  return withAuth(async () => {
    let body: SecretBody;
    try {
      body = (await req.json()) as SecretBody;
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    if (!body.ref) {
      return NextResponse.json({ error: 'validation_error', message: 'ref is required' }, { status: 400 });
    }

    try {
      deleteSecretSync(body.ref);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return secretErrorResponse(err);
    }
  });
}

function secretErrorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : 'Secret vault error';
  const missingMasterKey = message.includes('ANTHROCLAW_MASTER_KEY');
  return NextResponse.json(
    {
      error: missingMasterKey ? 'vault_unavailable' : 'secret_vault_error',
      message,
    },
    { status: missingMasterKey ? 503 : 400 },
  );
}

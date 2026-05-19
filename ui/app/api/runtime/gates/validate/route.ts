import { NextRequest, NextResponse } from 'next/server';
import { ValidationError } from '@/lib/agents';
import { withAuth } from '@/lib/route-handler';
import {
  validateRuntimeGateArgs,
  type RuntimeGateArgs,
} from '@/lib/runtime-control-plane';

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json();
    const gateId = typeof body?.gateId === 'string' ? body.gateId : '';
    if (!gateId) {
      throw new ValidationError('invalid_gate_request', '"gateId" is required');
    }

    const result = validateRuntimeGateArgs(gateId, readGateArgs(body));
    if (!result) {
      throw new ValidationError('unknown_gate', `Unknown runtime gate: ${gateId}`);
    }

    return NextResponse.json(result);
  });
}

function readGateArgs(body: unknown): RuntimeGateArgs {
  if (!body || typeof body !== 'object') return {};
  const args = (body as { args?: unknown }).args;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  return args as RuntimeGateArgs;
}

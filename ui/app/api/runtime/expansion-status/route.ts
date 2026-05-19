import { resolve } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { ValidationError } from '@/lib/agents';
import { withAuth } from '@/lib/route-handler';
import {
  buildPiExpansionStatus,
  evaluatePiExpansionStatusPolicy,
  filterOpenAgents,
  parsePiExpansionStatusArgs,
  type PiExpansionStatusArgs,
} from '@backend/cli/pi-expansion-status.js';

const DEFAULT_AGENTS_DIR = process.env.OC_AGENTS_DIR
  ? resolve(process.env.OC_AGENTS_DIR)
  : resolve(process.cwd(), '..', 'agents');
const DEFAULT_PACKETS_DIR = resolve(process.cwd(), '..', 'research', 'pi-expansion-packets');

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    let args: PiExpansionStatusArgs;
    try {
      args = parsePiExpansionStatusArgs(queryToArgv(req.nextUrl.searchParams));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid expansion status query';
      throw new ValidationError('invalid_expansion_status_query', message);
    }

    const result = buildPiExpansionStatus(args);
    const policy = evaluatePiExpansionStatusPolicy(result, args);
    const output = {
      ...result,
      policy,
    };

    return NextResponse.json(args.openOnly ? filterOpenAgents(output) : output);
  });
}

function queryToArgv(params: URLSearchParams): string[] {
  const argv = ['--packets-dir', DEFAULT_PACKETS_DIR];
  const agentsDirs = params.getAll('agentsDir').filter(Boolean);
  if (agentsDirs.length === 0) argv.push('--agents-dir', DEFAULT_AGENTS_DIR);
  for (const agentsDir of agentsDirs) {
    if (agentsDir) argv.push('--agents-dir', agentsDir);
  }

  const packetsDir = params.get('packetsDir');
  if (packetsDir) argv.push('--packets-dir', packetsDir);

  const agent = params.get('agent');
  if (agent) argv.push('--agent', agent);

  if (isTruthy(params.get('openOnly'))) argv.push('--open-only');
  if (isTruthy(params.get('failOnOpen'))) argv.push('--fail-on-open');
  if (isTruthy(params.get('allowExternalOpen'))) argv.push('--allow-external-open');

  for (const kind of params.getAll('allowOpenKind')) {
    if (kind) argv.push('--allow-open-kind', kind);
  }

  return argv;
}

function isTruthy(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

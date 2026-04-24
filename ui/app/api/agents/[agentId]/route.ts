import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig, updateAgentConfig, deleteAgent, ValidationError } from '@/lib/agents';
import { stringify as stringifyYaml } from 'yaml';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    return NextResponse.json(getAgentConfig(agentId));
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = await req.json();

    let yaml: string;
    if (typeof body.yaml === 'string') {
      yaml = body.yaml;
    } else if (body.config && typeof body.config === 'object') {
      yaml = stringifyYaml(body.config);
    } else if (body.model || body.routes) {
      yaml = stringifyYaml(body);
    } else {
      throw new ValidationError('invalid_yaml', 'Provide "yaml" (string), "config" (object), or a bare agent config');
    }

    updateAgentConfig(agentId, yaml);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    deleteAgent(agentId);
    return NextResponse.json({ ok: true });
  });
}

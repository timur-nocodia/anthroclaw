import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { listAgents, createAgent, ValidationError } from '@/lib/agents';

export async function GET() {
  return withAuth(async () => {
    return NextResponse.json(listAgents());
  });
}

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json();
    const { id, model, template } = body as {
      id: string;
      model?: string;
      template?: 'blank' | 'example';
    };

    if (!id) {
      throw new ValidationError('invalid_id', 'id is required');
    }

    createAgent(id, model, template);
    return NextResponse.json({ id }, { status: 201 });
  });
}

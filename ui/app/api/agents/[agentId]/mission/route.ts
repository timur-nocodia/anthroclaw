import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig, ValidationError } from '@/lib/agents';
import {
  openMissionReadOnly,
  openMissionWritable,
  type MissionSnapshot,
} from '@/lib/mission';

const ModeSchema = z.enum(['lightweight', 'lifecycle', 'operations', 'custom']);
const PhaseSchema = z.enum(['define', 'design', 'build', 'verify', 'ship']);

const CreateMissionSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  mode: ModeSchema.default('lightweight'),
  phase: PhaseSchema.optional(),
  current_state: z.string().optional(),
  next_actions: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const ArchiveMissionSchema = z.object({
  reason: z.string().optional(),
});

function publicSnapshot(snapshot: MissionSnapshot | null, agentId: string): Record<string, unknown> {
  if (!snapshot) return { active: false, agentId };
  return {
    active: snapshot.mission.status === 'active',
    agentId,
    mission: {
      id: snapshot.mission.id,
      agent_id: snapshot.mission.agent_id,
      title: snapshot.mission.title,
      goal: snapshot.mission.goal,
      mode: snapshot.mission.mode,
      phase: snapshot.mission.phase,
      status: snapshot.mission.status,
      current_state: snapshot.mission.current_state,
      next_actions: snapshot.nextActions,
      metadata: snapshot.metadata,
      created_at: snapshot.mission.created_at,
      updated_at: snapshot.mission.updated_at,
      archived_at: snapshot.mission.archived_at,
    },
    objectives: snapshot.objectives,
    decisions: snapshot.decisions,
    recent_handoffs: snapshot.recentHandoffs,
    recent_events: snapshot.recentEvents,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    getAgentConfig(agentId);

    const handle = openMissionReadOnly(agentId);
    if (!handle) return NextResponse.json(publicSnapshot(null, agentId));

    try {
      return NextResponse.json(publicSnapshot(handle.store.getActiveMission(agentId), agentId));
    } finally {
      handle.db.close();
    }
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    getAgentConfig(agentId);

    const body = await req.json().catch(() => null);
    const parsed = CreateMissionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_body', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const handle = openMissionWritable(agentId);
    try {
      const snapshot = handle.store.createMission({
        agentId,
        title: parsed.data.title,
        goal: parsed.data.goal,
        mode: parsed.data.mode,
        phase: parsed.data.phase,
        currentState: parsed.data.current_state,
        nextActions: parsed.data.next_actions,
        metadata: parsed.data.metadata,
      });
      return NextResponse.json(publicSnapshot(snapshot, agentId));
    } finally {
      handle.db.close();
    }
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    getAgentConfig(agentId);

    const body = await req.json().catch(() => ({}));
    const parsed = ArchiveMissionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_body', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const handle = openMissionWritable(agentId);
    try {
      const active = handle.store.getActiveMission(agentId);
      if (!active) {
        throw new ValidationError('no_active_mission', `No active mission for agent ${agentId}`);
      }
      const snapshot = handle.store.archiveMission(active.mission.id, parsed.data.reason ?? '');
      return NextResponse.json(publicSnapshot(snapshot, agentId));
    } finally {
      handle.db.close();
    }
  });
}

import { z } from 'zod';
import type { PluginMcpTool } from '../types-shim.js';
import { jsonText } from '../format.js';
import type { MissionConfig } from '../config.js';
import {
  MissionStore,
  missionIdFromSnapshot,
  resolveMissionMode,
  type MissionMode,
  type MissionPhase,
  type MissionSnapshot,
} from '../store.js';

export interface MissionToolDeps {
  getStore(agentId: string): MissionStore;
  getConfig(agentId: string): MissionConfig;
}

const MODE_SCHEMA = z.enum(['lightweight', 'lifecycle', 'operations', 'custom']);
const PHASE_SCHEMA = z.enum(['define', 'design', 'build', 'verify', 'ship']);
const DECISION_STATUS_SCHEMA = z.enum(['pending', 'good', 'revisit']);

const STRINGS_SCHEMA = z.array(z.string().min(1)).default([]);
const METADATA_SCHEMA = z.record(z.string(), z.unknown()).default({});

function publicSnapshot(snapshot: MissionSnapshot | null): Record<string, unknown> {
  if (!snapshot) return { active: false };
  return {
    active: snapshot.mission.status === 'active',
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

function activeMission(store: MissionStore, agentId: string): MissionSnapshot {
  const snapshot = store.getActiveMission(agentId);
  if (!snapshot) {
    throw new Error('no active mission; call mission_create first');
  }
  return snapshot;
}

export function createStatusTool(deps: MissionToolDeps): PluginMcpTool {
  return {
    name: 'status',
    description: 'Read the active mission state for this agent.',
    inputSchema: z.object({}),
    handler: async (_raw, ctx) => {
      const config = deps.getConfig(ctx.agentId);
      const snapshot = deps.getStore(ctx.agentId).getActiveMission(ctx.agentId);
      return jsonText({ ok: true, config, ...publicSnapshot(snapshot) });
    },
  };
}

export function createCreateTool(deps: MissionToolDeps): PluginMcpTool {
  const inputSchema = z.object({
    title: z.string().min(1),
    goal: z.string().min(1),
    mode: MODE_SCHEMA.optional(),
    phase: PHASE_SCHEMA.optional(),
    current_state: z.string().optional(),
    next_actions: STRINGS_SCHEMA.optional(),
    metadata: METADATA_SCHEMA.optional(),
  });

  return {
    name: 'create',
    description: 'Create a new active mission for this agent.',
    inputSchema,
    handler: async (raw, ctx) => {
      const input = inputSchema.parse(raw);
      const config = deps.getConfig(ctx.agentId);
      const snapshot = deps.getStore(ctx.agentId).createMission({
        agentId: ctx.agentId,
        title: input.title,
        goal: input.goal,
        mode: resolveMissionMode(config, input.mode as MissionMode | undefined),
        phase: input.phase as MissionPhase | undefined,
        currentState: input.current_state,
        nextActions: input.next_actions,
        metadata: input.metadata,
      });
      return jsonText({ ok: true, ...publicSnapshot(snapshot) });
    },
  };
}

export function createUpdateStateTool(deps: MissionToolDeps): PluginMcpTool {
  const inputSchema = z.object({
    current_state: z.string().min(1),
    next_actions: STRINGS_SCHEMA.optional(),
  });

  return {
    name: 'update_state',
    description: 'Update current state and next actions for the active mission.',
    inputSchema,
    handler: async (raw, ctx) => {
      const input = inputSchema.parse(raw);
      const store = deps.getStore(ctx.agentId);
      const missionId = missionIdFromSnapshot(activeMission(store, ctx.agentId));
      const snapshot = store.updateState(missionId!, input.current_state, input.next_actions ?? []);
      return jsonText({ ok: true, ...publicSnapshot(snapshot) });
    },
  };
}

export function createObjectiveTools(deps: MissionToolDeps): PluginMcpTool[] {
  const addSchema = z.object({
    content: z.string().min(1),
    rationale: z.string().optional(),
  });
  const statusSchema = z.object({
    objective_id: z.string().min(1),
    rationale: z.string().optional(),
  });

  return [
    {
      name: 'add_objective',
      description: 'Add an active objective to the current mission.',
      inputSchema: addSchema,
      handler: async (raw, ctx) => {
        const input = addSchema.parse(raw);
        const store = deps.getStore(ctx.agentId);
        const missionId = missionIdFromSnapshot(activeMission(store, ctx.agentId));
        const objective = store.addObjective(missionId!, input.content, input.rationale);
        return jsonText({ ok: true, objective });
      },
    },
    {
      name: 'validate_objective',
      description: 'Mark a mission objective as validated/proven.',
      inputSchema: statusSchema,
      handler: async (raw, ctx) => {
        const input = statusSchema.parse(raw);
        const objective = deps.getStore(ctx.agentId).setObjectiveStatus(input.objective_id, 'validated', input.rationale);
        return jsonText({ ok: true, objective });
      },
    },
    {
      name: 'reject_objective',
      description: 'Mark a mission objective as rejected/out of scope with reasoning.',
      inputSchema: statusSchema,
      handler: async (raw, ctx) => {
        const input = statusSchema.parse(raw);
        const objective = deps.getStore(ctx.agentId).setObjectiveStatus(input.objective_id, 'rejected', input.rationale);
        return jsonText({ ok: true, objective });
      },
    },
  ];
}

export function createDecisionTool(deps: MissionToolDeps): PluginMcpTool {
  const inputSchema = z.object({
    decision: z.string().min(1),
    rationale: z.string().optional(),
    status: DECISION_STATUS_SCHEMA.optional(),
    outcome: z.string().optional(),
  });

  return {
    name: 'add_decision',
    description: 'Record a mission decision and rationale for future sessions.',
    inputSchema,
    handler: async (raw, ctx) => {
      const input = inputSchema.parse(raw);
      const store = deps.getStore(ctx.agentId);
      const missionId = missionIdFromSnapshot(activeMission(store, ctx.agentId));
      const decision = store.addDecision(
        missionId!,
        input.decision,
        input.rationale,
        input.status,
        input.outcome,
      );
      return jsonText({ ok: true, decision });
    },
  };
}

export function createTransitionPhaseTool(deps: MissionToolDeps): PluginMcpTool {
  const inputSchema = z.object({
    phase: PHASE_SCHEMA,
    note: z.string().optional(),
  });

  return {
    name: 'transition_phase',
    description: 'Move the active mission to a new lifecycle phase.',
    inputSchema,
    handler: async (raw, ctx) => {
      const input = inputSchema.parse(raw);
      const store = deps.getStore(ctx.agentId);
      const missionId = missionIdFromSnapshot(activeMission(store, ctx.agentId));
      const snapshot = store.transitionPhase(missionId!, input.phase, input.note);
      return jsonText({ ok: true, ...publicSnapshot(snapshot) });
    },
  };
}

export function createWrapSessionTool(deps: MissionToolDeps): PluginMcpTool {
  const inputSchema = z.object({
    summary: z.string().min(1),
    next_actions: STRINGS_SCHEMA.optional(),
    metadata: METADATA_SCHEMA.optional(),
  });

  return {
    name: 'wrap_session',
    description: 'Write a structured handoff for the current mission session.',
    inputSchema,
    handler: async (raw, ctx) => {
      const input = inputSchema.parse(raw);
      const store = deps.getStore(ctx.agentId);
      const missionId = missionIdFromSnapshot(activeMission(store, ctx.agentId));
      const handoff = store.wrapSession(
        missionId!,
        ctx.sessionKey ?? null,
        input.summary,
        input.next_actions ?? [],
        input.metadata ?? {},
      );
      return jsonText({ ok: true, handoff });
    },
  };
}

export function createArchiveTool(deps: MissionToolDeps): PluginMcpTool {
  const inputSchema = z.object({
    reason: z.string().optional(),
  });

  return {
    name: 'archive',
    description: 'Archive the active mission without deleting its data.',
    inputSchema,
    handler: async (raw, ctx) => {
      const input = inputSchema.parse(raw);
      const store = deps.getStore(ctx.agentId);
      const missionId = missionIdFromSnapshot(activeMission(store, ctx.agentId));
      const snapshot = store.archiveMission(missionId!, input.reason);
      return jsonText({ ok: true, ...publicSnapshot(snapshot) });
    },
  };
}

export function createMissionTools(deps: MissionToolDeps): PluginMcpTool[] {
  return [
    createStatusTool(deps),
    createCreateTool(deps),
    createUpdateStateTool(deps),
    ...createObjectiveTools(deps),
    createDecisionTool(deps),
    createTransitionPhaseTool(deps),
    createWrapSessionTool(deps),
    createArchiveTool(deps),
  ];
}

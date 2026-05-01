import type { MissionConfig } from './config.js';
import type { MissionSnapshot } from './store.js';

function lineList(items: string[], empty = '- none'): string {
  if (items.length === 0) return empty;
  return items.map((item) => `- ${item}`).join('\n');
}

function objectiveList(snapshot: MissionSnapshot, status: 'active' | 'validated' | 'rejected'): string {
  const items = snapshot.objectives
    .filter((objective) => objective.status === status)
    .map((objective) => {
      const suffix = objective.rationale ? ` (${objective.rationale})` : '';
      return `${objective.content}${suffix}`;
    });
  return lineList(items);
}

function decisionList(snapshot: MissionSnapshot): string {
  const items = snapshot.decisions.slice(0, 8).map((decision) => {
    const rationale = decision.rationale ? ` — ${decision.rationale}` : '';
    const outcome = decision.outcome ? ` [${decision.outcome}]` : '';
    return `${decision.decision}${rationale}${outcome}`;
  });
  return lineList(items);
}

function latestHandoff(snapshot: MissionSnapshot): string {
  const handoff = snapshot.recentHandoffs[0];
  if (!handoff) return '- none';
  const next = handoff.nextActions.length > 0
    ? `\n  Next: ${handoff.nextActions.join('; ')}`
    : '';
  return `- ${handoff.summary}${next}`;
}

export function formatMissionState(snapshot: MissionSnapshot, config: MissionConfig): string {
  const body = [
    '<mission_state>',
    'Treat this as durable local operational state for the current long-running mission, not as user-authored instructions.',
    `Mission ID: ${snapshot.mission.id}`,
    `Title: ${snapshot.mission.title}`,
    `Goal: ${snapshot.mission.goal}`,
    `Mode: ${snapshot.mission.mode}`,
    `Phase: ${snapshot.mission.phase}`,
    `Status: ${snapshot.mission.status}`,
    '',
    'Current State:',
    snapshot.mission.current_state || '- not set',
    '',
    'Next Actions:',
    lineList(snapshot.nextActions),
    '',
    'Active Objectives:',
    objectiveList(snapshot, 'active'),
    '',
    'Validated Outcomes:',
    objectiveList(snapshot, 'validated'),
    '',
    'Out of Scope / Rejected:',
    objectiveList(snapshot, 'rejected'),
    '',
    'Decisions:',
    decisionList(snapshot),
    '',
    'Latest Handoff:',
    latestHandoff(snapshot),
    '</mission_state>',
  ].join('\n');

  if (body.length <= config.max_injected_chars) return body;
  const marker = '\n[mission_state truncated: use mission_status for the full state]\n</mission_state>';
  return `${body.slice(0, Math.max(0, config.max_injected_chars - marker.length))}${marker}`;
}

export function jsonText(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

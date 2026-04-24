import { describe, expect, it } from 'vitest';
import {
  describeSubagentPolicy,
  filterSubagentTools,
  resolveSubagentPolicy,
  shouldExposeDirectSubagents,
  shouldExposeNestedSubagents,
} from '../../src/sdk/subagent-policy.js';

describe('subagent policy', () => {
  it('resolves configured role policy with safe defaults', () => {
    const policy = resolveSubagentPolicy({
      allow: ['researcher'],
      conflict_mode: 'strict',
      roles: {
        researcher: {
          kind: 'explorer',
          write_policy: 'deny',
        },
      },
    }, 'researcher');

    expect(policy).toMatchObject({
      subagentId: 'researcher',
      kind: 'explorer',
      writePolicy: 'deny',
      conflictMode: 'strict',
    });
    expect(describeSubagentPolicy(policy)).toBe('role=explorer, write_policy=deny, conflict_mode=strict');
  });

  it('filters write-capable tools only for deny policy', () => {
    const tools = [
      'Read',
      'Write',
      'Edit',
      'Bash',
      'mcp__helper-subagent-tools__memory_search',
      'mcp__helper-subagent-tools__memory_write',
    ];

    expect(filterSubagentTools(tools, { writePolicy: 'deny' })).toEqual([
      'Read',
      'mcp__helper-subagent-tools__memory_search',
    ]);
    expect(filterSubagentTools(tools, { writePolicy: 'claim_required' })).toEqual(tools);
  });

  it('maps max_spawn_depth to available SDK delegation surfaces', () => {
    expect(shouldExposeDirectSubagents({ allow: ['a'], max_spawn_depth: 0 })).toBe(false);
    expect(shouldExposeDirectSubagents({ allow: ['a'], max_spawn_depth: 1 })).toBe(true);
    expect(shouldExposeNestedSubagents({ allow: ['a'], max_spawn_depth: 1 })).toBe(false);
    expect(shouldExposeNestedSubagents({ allow: ['a'], max_spawn_depth: 2 })).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SIDE_EFFECT_GATE_REGISTRY,
  sideEffectGateIds,
} from '../side-effect-gates/registry.js';

describe('side-effect gate registry', () => {
  it('declares unique generic gate ids and runnable package scripts', () => {
    const ids = sideEffectGateIds();
    expect(ids).toHaveLength(SIDE_EFFECT_GATE_REGISTRY.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'controlled-live-turn',
      'live-send-message',
      'live-send-media',
      'live-notification',
      'cron-notification',
      'scheduled-work',
      'buildroom-handoff',
      'admin-config',
      'mcp-file-transfer',
      'honcho-local',
      'learning-propose',
      'memory-read',
    ]);

    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    for (const gate of SIDE_EFFECT_GATE_REGISTRY) {
      expect(gate.id).not.toContain('timur');
      expect(gate.title).toMatch(/\S/);
      expect(gate.summary).toMatch(/\S/);
      expect(gate.capabilityGroup).toMatch(/^(messaging|scheduling|workspace|configuration|integration|learning|memory)$/);
      expect(gate.focusedCommand).toMatch(/^runtime:pi-.+-gate$/);
      expect(gate.execution.requiredFlags).toContain('agent-id');
      expect(gate.execution.requiredFlags).toContain('peer-id');
      expect(gate.execution.safetyMode).toMatch(/^(dry-run-first|temp-only|propose-only|read-only)$/);
      expect(gate.execution.approval).toMatch(/^(required-for-live|operator-review|not-required-read-only)$/);
      expect(packageJson.scripts[gate.focusedCommand]).toBeTruthy();
      const compatibilityCommand = 'compatibilityCommand' in gate ? gate.compatibilityCommand : undefined;
      expect(compatibilityCommand, `${gate.id} should not expose a named-agent compatibility command`).toBeUndefined();
    }
  });

  it('declares execution hints for automation without agent-specific defaults', () => {
    const byId = Object.fromEntries(SIDE_EFFECT_GATE_REGISTRY.map((gate) => [gate.id, gate]));

    expect(byId['live-send-message']?.execution).toMatchObject({
      requiredFlags: ['agent-id', 'peer-id'],
      supportsDryRun: true,
      safetyMode: 'dry-run-first',
      approval: 'required-for-live',
    });
    expect(byId['live-send-message']).toMatchObject({
      title: 'Live Send Message',
      capabilityGroup: 'messaging',
    });
    expect(byId['controlled-live-turn']?.execution).toMatchObject({
      requiredFlags: ['agent-id', 'peer-id', 'thread-id'],
      supportsDryRun: true,
      safetyMode: 'dry-run-first',
      approval: 'required-for-live',
    });
    expect(byId['controlled-live-turn']).toMatchObject({
      title: 'Controlled Live Turn',
      capabilityGroup: 'messaging',
    });
    expect(byId['live-send-media']?.execution.requiredFlags).toEqual([
      'agent-id',
      'peer-id',
      'file-path',
      'allowed-file-root',
    ]);
    expect(byId['memory-read']?.execution).toMatchObject({
      requiredFlags: ['agent-id', 'peer-id', 'sender-id'],
      supportsDryRun: false,
      safetyMode: 'read-only',
      approval: 'not-required-read-only',
    });
    expect(byId['memory-read']).toMatchObject({
      title: 'Memory Read',
      capabilityGroup: 'memory',
    });
    expect(byId['scheduled-work']?.execution).toMatchObject({
      requiredFlags: ['agent-id', 'peer-id', 'sender-id'],
      supportsDryRun: false,
      safetyMode: 'temp-only',
      approval: 'operator-review',
    });
    expect(byId['scheduled-work']).toMatchObject({
      title: 'Scheduled Work',
      capabilityGroup: 'scheduling',
    });

    for (const gate of SIDE_EFFECT_GATE_REGISTRY) {
      expect(gate.execution.exampleArgs.join(' ')).not.toContain('runtime_test_agent');
      expect(gate.execution.exampleArgs).toContain('--agent-id');
      expect(gate.execution.exampleArgs).toContain('<id>');
    }
  });

  it('keeps aggregate dispatcher coverage explicit', () => {
    const aggregateIds = SIDE_EFFECT_GATE_REGISTRY
      .filter((gate) => gate.aggregateDispatcher)
      .map((gate) => gate.id);

    expect(aggregateIds).toEqual(sideEffectGateIds());
  });

  it('keeps the operator docs anchored to the registry', () => {
    const docs = readFileSync(join(process.cwd(), 'docs/runtime-side-effect-gates.md'), 'utf8');

    expect(docs).toContain('src/runtime/side-effect-gates/registry.ts');
    for (const gate of SIDE_EFFECT_GATE_REGISTRY) {
      expect(docs).toContain(gate.id);
      expect(docs).toContain(gate.focusedCommand);
    }
  });
});

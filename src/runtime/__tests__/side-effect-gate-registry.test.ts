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
      'live-send-message',
      'live-send-media',
      'live-notification',
      'cron-notification',
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
      expect(gate.focusedCommand).toMatch(/^runtime:pi-.+-gate$/);
      expect(packageJson.scripts[gate.focusedCommand]).toBeTruthy();
      if (gate.compatibilityCommand) {
        expect(gate.compatibilityCommand).toContain('timur-agent');
        expect(packageJson.scripts[gate.compatibilityCommand]).toBeTruthy();
      }
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

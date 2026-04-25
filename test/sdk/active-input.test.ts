import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createFallbackActiveInputController,
  FallbackActiveInputController,
  getSdkActiveInputStatus,
} from '../../src/sdk/active-input.js';

describe('sdk active input', () => {
  it('reports native active input as disabled by default', () => {
    expect(getSdkActiveInputStatus()).toMatchObject({
      streamInputAvailable: true,
      unstableSessionApiAvailable: true,
      featureFlagEnabled: false,
      nativeSteerEnabled: false,
      fallbackMode: 'interrupt_and_restart',
      steerDeliveryState: 'fallback_interrupt_restart',
      uiDeliveryStates: ['fallback_interrupt_restart', 'unsupported'],
    });
  });

  it('keeps native steering disabled even when the feature flag is enabled', () => {
    const status = getSdkActiveInputStatus(true);

    expect(status).toMatchObject({
      featureFlagEnabled: true,
      nativeSteerEnabled: false,
      fallbackMode: 'interrupt_and_restart',
      steerDeliveryState: 'fallback_interrupt_restart',
    });
    expect(status.reason).toContain('still falls back to interrupt-and-restart');
  });

  it('returns interrupt-and-restart delivery from the fallback controller', async () => {
    const controller = createFallbackActiveInputController(true);

    await expect(controller.sendUserMessage('continue')).resolves.toEqual({
      state: 'fallback_interrupt_restart',
      shouldStartReplacementRun: true,
      reason: getSdkActiveInputStatus(true).reason,
    });
  });

  it('does not start replacement runs after the controller is closed', async () => {
    const controller = new FallbackActiveInputController();
    controller.close();

    await expect(controller.sendUserMessage('continue')).resolves.toEqual({
      state: 'closed',
      shouldStartReplacementRun: false,
      reason: 'Active input controller is closed.',
    });
  });

  it('keeps the fallback layer away from SDK transcript and streaming write APIs', () => {
    const source = readFileSync(new URL('../../src/sdk/active-input.ts', import.meta.url), 'utf-8');

    expect(source).not.toMatch(/from ['"]node:fs/);
    expect(source).not.toMatch(/from ['"]fs/);
    expect(source).not.toMatch(/\bappendFile\b|\bwriteFile\b|\bSessionStore\b/);
    expect(source).not.toMatch(/\btranscript_path\b|\bSDKSession\.send\b|\bunstable_v2_/);
    expect(source).not.toMatch(/\bstreamInput\(/);
  });
});

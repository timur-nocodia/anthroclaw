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
    });
  });

  it('keeps native steering disabled even when the feature flag is enabled', () => {
    const status = getSdkActiveInputStatus(true);

    expect(status).toMatchObject({
      featureFlagEnabled: true,
      nativeSteerEnabled: false,
      fallbackMode: 'interrupt_and_restart',
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
});

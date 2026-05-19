import { describe, it, expect } from 'vitest';
import { DisconnectReason } from '@whiskeysockets/baileys';

import {
  handleDisconnect,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_BACKOFF_MS,
  TERMINAL_DISCONNECT_CODES,
} from '../whatsapp.js';

describe('handleDisconnect', () => {
  it('stops on manual teardown regardless of statusCode', () => {
    expect(handleDisconnect({ statusCode: 440, attempts: 0, manualTeardown: true }))
      .toEqual({ action: 'stop', reason: 'manual' });
    expect(handleDisconnect({ statusCode: undefined, attempts: 3, manualTeardown: true }))
      .toEqual({ action: 'stop', reason: 'manual' });
  });

  it.each([
    DisconnectReason.loggedOut,
    DisconnectReason.forbidden,
    DisconnectReason.multideviceMismatch,
    DisconnectReason.connectionReplaced,
    DisconnectReason.badSession,
  ])('stops on terminal disconnect code %i (and never schedules a retry)', (code) => {
    const d = handleDisconnect({ statusCode: code, attempts: 0, manualTeardown: false });
    expect(d).toEqual({ action: 'stop', reason: 'terminal', statusCode: code });
  });

  it('classifies exactly the documented terminal codes', () => {
    expect([...TERMINAL_DISCONNECT_CODES].sort()).toEqual([401, 403, 411, 440, 500]);
  });

  it('retries on recoverable codes with the first backoff slot when attempts=0', () => {
    const d = handleDisconnect({
      statusCode: DisconnectReason.restartRequired,
      attempts: 0,
      manualTeardown: false,
    });
    expect(d).toEqual({
      action: 'retry',
      reason: 'backoff',
      delayMs: RECONNECT_BACKOFF_MS[0],
      nextAttempts: 1,
      statusCode: DisconnectReason.restartRequired,
    });
  });

  it('retries when statusCode is undefined (network-level close)', () => {
    const d = handleDisconnect({ statusCode: undefined, attempts: 0, manualTeardown: false });
    expect(d.action).toBe('retry');
  });

  it('escalates delay through the backoff schedule and caps at the last slot', () => {
    for (let attempts = 0; attempts < MAX_RECONNECT_ATTEMPTS; attempts++) {
      const d = handleDisconnect({
        statusCode: DisconnectReason.connectionClosed,
        attempts,
        manualTeardown: false,
      });
      if (d.action !== 'retry') throw new Error('expected retry');
      const expectedSlot = Math.min(attempts, RECONNECT_BACKOFF_MS.length - 1);
      expect(d.delayMs).toBe(RECONNECT_BACKOFF_MS[expectedSlot]);
      expect(d.nextAttempts).toBe(attempts + 1);
    }
  });

  it('stops after MAX_RECONNECT_ATTEMPTS even for recoverable codes', () => {
    const d = handleDisconnect({
      statusCode: DisconnectReason.restartRequired,
      attempts: MAX_RECONNECT_ATTEMPTS,
      manualTeardown: false,
    });
    expect(d).toEqual({
      action: 'stop',
      reason: 'max_retries',
      statusCode: DisconnectReason.restartRequired,
      attempts: MAX_RECONNECT_ATTEMPTS,
    });
  });
});

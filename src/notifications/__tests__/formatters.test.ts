import { describe, it, expect } from 'vitest';
import { formatTelegram, formatPlain, formatForChannel } from '../formatters.js';

// Pin "now" so same-day vs older formatting is deterministic.
const NOW = new Date('2026-05-01T12:00:00Z');

describe('formatTelegram', () => {
  it('peer_pause_started — bold header, code-fenced peer, formatted time', () => {
    const msg = formatTelegram(
      'peer_pause_started',
      {
        agentId: 'amina',
        peerKey: 'whatsapp:business:37120@s.whatsapp.net',
        expiresAt: '2026-05-01T12:30:00Z',
        timezone: 'Asia/Almaty', // +5h → 17:30
      },
      NOW,
    );
    expect(msg).toContain('*Auto-pause*');
    expect(msg).toContain('`amina`');
    expect(msg).toContain('`whatsapp:business:37120@s.whatsapp.net`');
    expect(msg).toContain('17:30');
  });

  it('peer_pause_started — UTC fallback when timezone missing', () => {
    const msg = formatTelegram(
      'peer_pause_started',
      { agentId: 'amina', peerKey: 'wa:b:1', expiresAt: '2026-05-01T12:30:00Z' },
      NOW,
    );
    expect(msg).toContain('12:30');
  });

  it('peer_pause_ended — shows reason and resumed time', () => {
    const msg = formatTelegram(
      'peer_pause_ended',
      {
        agentId: 'amina',
        peerKey: 'wa:b:1',
        endedAt: '2026-05-01T12:30:00Z',
        reason: 'ttl_expired',
      },
      NOW,
    );
    expect(msg).toContain('*Pause ended*');
    expect(msg).toContain('`wa:b:1`');
    expect(msg).toContain('`ttl_expired`');
  });

  it('peer_pause_intervened_during_generation — explains suppression', () => {
    const msg = formatTelegram(
      'peer_pause_intervened_during_generation',
      { agentId: 'amina', peerKey: 'wa:b:1', at: '2026-05-01T12:01:00Z' },
      NOW,
    );
    expect(msg).toContain('*Intervention suppressed*');
    expect(msg).toContain('`wa:b:1`');
    expect(msg).toContain('blocked');
  });

  it('peer_pause_summary_daily — total + per-peer counts', () => {
    const msg = formatTelegram(
      'peer_pause_summary_daily',
      {
        agentId: 'amina',
        activePauses: 2,
        items: [
          { peerKey: 'wa:b:1', count: 3 },
          { peerKey: 'wa:b:2', count: 1 },
        ],
      },
      NOW,
    );
    expect(msg).toContain('*Daily pause summary*');
    expect(msg).toContain('Active pauses: 2');
    expect(msg).toContain('wa:b:1');
    expect(msg).toContain('wa:b:2');
  });

  it('agent_error — shows error message in code fence', () => {
    const msg = formatTelegram(
      'agent_error',
      { agentId: 'amina', message: 'rate_limit_exceeded', at: '2026-05-01T12:01:00Z' },
      NOW,
    );
    expect(msg).toContain('*Agent error*');
    expect(msg).toContain('`rate_limit_exceeded`');
  });

  it('iteration_budget_exhausted — shows turns', () => {
    const msg = formatTelegram(
      'iteration_budget_exhausted',
      { agentId: 'amina', peerKey: 'wa:b:1', turns: 30 },
      NOW,
    );
    expect(msg).toContain('*Iteration budget exhausted*');
    expect(msg).toContain('`30`');
    expect(msg).toContain('`wa:b:1`');
  });

  it('escalation_needed — includes note', () => {
    const msg = formatTelegram(
      'escalation_needed',
      { agentId: 'amina', peerKey: 'wa:b:1', note: 'human review please' },
      NOW,
    );
    expect(msg).toContain('*Escalation requested*');
    expect(msg).toContain('human review please');
  });

  it('older-than-today timestamp formats as MM-DD HH:mm', () => {
    const msg = formatTelegram(
      'peer_pause_started',
      { agentId: 'amina', peerKey: 'wa:b:1', expiresAt: '2026-04-29T08:30:00Z' },
      NOW,
    );
    expect(msg).toMatch(/04-29 08:30/);
  });
});

describe('formatPlain', () => {
  it('peer_pause_started — no markdown markers, contains key fields', () => {
    const msg = formatPlain(
      'peer_pause_started',
      { agentId: 'amina', peerKey: 'wa:b:1', expiresAt: '2026-05-01T12:30:00Z' },
      NOW,
    );
    expect(msg).not.toContain('*');
    expect(msg).not.toContain('`');
    expect(msg).toContain('amina');
    expect(msg).toContain('wa:b:1');
    expect(msg).toContain('12:30');
  });

  it('peer_pause_ended — plain output without code fences', () => {
    const msg = formatPlain(
      'peer_pause_ended',
      { agentId: 'amina', peerKey: 'wa:b:1', endedAt: '2026-05-01T12:30:00Z', reason: 'manual' },
      NOW,
    );
    expect(msg).not.toContain('`');
    expect(msg).toContain('manual');
    expect(msg).toContain('amina');
  });

  it('peer_pause_summary_daily — bullets without markdown bold', () => {
    const msg = formatPlain(
      'peer_pause_summary_daily',
      {
        agentId: 'amina',
        activePauses: 1,
        items: [{ peerKey: 'wa:b:1', count: 2 }],
      },
      NOW,
    );
    expect(msg).not.toContain('*');
    expect(msg).toContain('Active pauses: 1');
    expect(msg).toContain('wa:b:1');
  });

  it('all event names produce non-empty plain output (smoke)', () => {
    const events = [
      'peer_pause_started',
      'peer_pause_ended',
      'peer_pause_intervened_during_generation',
      'peer_pause_summary_daily',
      'agent_error',
      'iteration_budget_exhausted',
      'escalation_needed',
    ] as const;
    for (const ev of events) {
      const msg = formatPlain(ev, { agentId: 'a' }, NOW);
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toContain('*');
      expect(msg).not.toContain('`');
    }
  });
});

describe('formatForChannel', () => {
  it('telegram → markdown formatter', () => {
    const msg = formatForChannel('telegram', 'peer_pause_started', { agentId: 'a', peerKey: 'p' }, NOW);
    expect(msg).toContain('*Auto-pause*');
  });
  it('whatsapp → plain formatter', () => {
    const msg = formatForChannel('whatsapp', 'peer_pause_started', { agentId: 'a', peerKey: 'p' }, NOW);
    expect(msg).not.toContain('*');
    expect(msg).toContain('Auto-pause');
  });
});

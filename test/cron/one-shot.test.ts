import { describe, expect, it } from 'vitest';
import { looksLikeOneShotSchedule, oneShotScheduleTimeUtc } from '../../src/cron/one-shot.js';

describe('one-shot cron helpers', () => {
  it('recognizes concrete day/month schedules as one-shot', () => {
    expect(looksLikeOneShotSchedule('0 8 30 4 *')).toBe(true);
    expect(looksLikeOneShotSchedule('*/5 * * * *')).toBe(false);
    expect(looksLikeOneShotSchedule('0 4 * * 1-5')).toBe(false);
    expect(looksLikeOneShotSchedule('0 8 30 4 1')).toBe(false);
  });

  it('returns the UTC fire time for valid one-shot schedules', () => {
    expect(oneShotScheduleTimeUtc('0 8 30 4 *', 2026)).toBe(Date.UTC(2026, 3, 30, 8, 0, 0, 0));
  });

  it('rejects impossible dates', () => {
    expect(oneShotScheduleTimeUtc('0 8 31 2 *', 2026)).toBeUndefined();
  });
});

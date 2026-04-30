import { describe, expect, it } from 'vitest';
import { isHeartbeatContentEffectivelyEmpty, parseHeartbeatFile } from '../parser.js';

describe('parseHeartbeatFile', () => {
  it('parses valid heartbeat tasks', () => {
    const parsed = parseHeartbeatFile(`
# Daily Ops

tasks:
  - name: standup
    interval: 1d
    prompt: "Read metrics and prepare the standup."
  - name: inbox
    interval: 30m
    prompt: Check incoming requests.
`);

    expect(parsed.tasks).toEqual([
      { name: 'standup', interval: '1d', prompt: 'Read metrics and prepare the standup.' },
      { name: 'inbox', interval: '30m', prompt: 'Check incoming requests.' },
    ]);
    expect(parsed.invalidTasks).toEqual([]);
  });

  it('parses optional script, skills, and timeout fields', () => {
    const parsed = parseHeartbeatFile(`
tasks:
  - name: metrics-watch
    interval: 10m
    prompt: Analyze changed metrics.
    script: scripts/check-metrics.js --since 10m
    skills: metrics, reporting
    timeout_ms: 5000
`);

    expect(parsed.tasks).toEqual([
      {
        name: 'metrics-watch',
        interval: '10m',
        prompt: 'Analyze changed metrics.',
        script: 'scripts/check-metrics.js --since 10m',
        skills: ['metrics', 'reporting'],
        timeout_ms: 5000,
      },
    ]);
  });

  it('reports invalid partial tasks', () => {
    const parsed = parseHeartbeatFile(`
tasks:
  - name: broken
    interval: 10m
  - name:
    prompt: Missing name and interval.
`);

    expect(parsed.tasks).toEqual([]);
    expect(parsed.invalidTasks).toEqual([
      { name: 'broken', reason: 'task requires name, interval, and prompt' },
      { reason: 'task requires name, interval, and prompt' },
    ]);
  });

  it('preserves non-task markdown as context', () => {
    const parsed = parseHeartbeatFile(`
# Heartbeat

Use the team metrics from docs/metrics.md.

tasks:
  - name: metrics
    interval: 1h
    prompt: Summarize changes.

## Notes
Prefer short Telegram responses.
`);

    expect(parsed.context).toContain('Use the team metrics from docs/metrics.md.');
    expect(parsed.context).toContain('Prefer short Telegram responses.');
    expect(parsed.context).not.toContain('tasks:');
  });

  it('treats heading-only markdown as effectively empty', () => {
    expect(isHeartbeatContentEffectivelyEmpty('# HEARTBEAT\n\n## Tasks\n\n```md\n```')).toBe(true);
    expect(isHeartbeatContentEffectivelyEmpty('# HEARTBEAT\n\nKeep watching metrics.')).toBe(false);
  });
});

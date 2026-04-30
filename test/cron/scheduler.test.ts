import { describe, it, expect, vi, afterEach } from 'vitest';
import { CronScheduler, SILENT_MARKER, isSilentResponse, processNoReplySentinel, type ScheduledJob } from '../../src/cron/scheduler.js';

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'test-job',
    agentId: 'bot-a',
    schedule: '0 9 * * *',
    prompt: 'Hello from cron',
    enabled: true,
    ...overrides,
  };
}

describe('CronScheduler', () => {
  let scheduler: CronScheduler;

  afterEach(() => {
    scheduler?.stop();
  });

  it('adds an enabled job and lists it', () => {
    const handler = vi.fn(async () => {});
    scheduler = new CronScheduler(handler);

    scheduler.addJob(makeJob());

    expect(scheduler.listJobs()).toEqual(['bot-a:test-job']);
  });

  it('skips disabled jobs', () => {
    const handler = vi.fn(async () => {});
    scheduler = new CronScheduler(handler);

    scheduler.addJob(makeJob({ enabled: false }));

    expect(scheduler.listJobs()).toEqual([]);
  });

  it('skips expired jobs', () => {
    const handler = vi.fn(async () => {});
    scheduler = new CronScheduler(handler);

    scheduler.addJob(makeJob({ expiresAt: Date.now() - 1 }));

    expect(scheduler.listJobs()).toEqual([]);
  });

  it('registers multiple jobs from different agents', () => {
    const handler = vi.fn(async () => {});
    scheduler = new CronScheduler(handler);

    scheduler.addJob(makeJob({ id: 'j1', agentId: 'agent-a' }));
    scheduler.addJob(makeJob({ id: 'j2', agentId: 'agent-a' }));
    scheduler.addJob(makeJob({ id: 'j1', agentId: 'agent-b' }));

    const jobs = scheduler.listJobs();
    expect(jobs).toHaveLength(3);
    expect(jobs).toContain('agent-a:j1');
    expect(jobs).toContain('agent-a:j2');
    expect(jobs).toContain('agent-b:j1');
  });

  it('stop() clears all jobs', () => {
    const handler = vi.fn(async () => {});
    scheduler = new CronScheduler(handler);

    scheduler.addJob(makeJob({ id: 'j1' }));
    scheduler.addJob(makeJob({ id: 'j2' }));
    expect(scheduler.listJobs()).toHaveLength(2);

    scheduler.stop();
    expect(scheduler.listJobs()).toEqual([]);
  });

  it('fires handler when job triggers (every-second schedule)', async () => {
    const handler = vi.fn(async () => {});
    scheduler = new CronScheduler(handler);

    // Use per-second cron: fires every second
    scheduler.addJob(makeJob({ schedule: '* * * * * *' }));

    // Wait enough for at least one tick
    await new Promise((r) => setTimeout(r, 1500));

    expect(handler).toHaveBeenCalled();
    const calledJob = handler.mock.calls[0][0] as ScheduledJob;
    expect(calledJob.id).toBe('test-job');
    expect(calledJob.agentId).toBe('bot-a');
  });

  it('handler errors do not crash the scheduler', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    scheduler = new CronScheduler(handler);

    scheduler.addJob(makeJob({ schedule: '* * * * * *' }));

    await new Promise((r) => setTimeout(r, 1500));

    // Handler was called and threw, but scheduler still has the job
    expect(handler).toHaveBeenCalled();
    expect(scheduler.listJobs()).toHaveLength(1);
  });
});

describe('SILENT_MARKER', () => {
  it('equals [SILENT]', () => {
    expect(SILENT_MARKER).toBe('[SILENT]');
  });
});

describe('isSilentResponse', () => {
  it('returns true when response contains [SILENT]', () => {
    expect(isSilentResponse('[SILENT]')).toBe(true);
  });

  it('returns true when [SILENT] is embedded in text', () => {
    expect(isSilentResponse('Nothing to report. [SILENT]')).toBe(true);
  });

  it('returns true when [SILENT] appears at the start', () => {
    expect(isSilentResponse('[SILENT] no output needed')).toBe(true);
  });

  it('returns false for plain text without marker', () => {
    expect(isSilentResponse('Hello world')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSilentResponse('')).toBe(false);
  });

  it('returns false for partial marker', () => {
    expect(isSilentResponse('[SILEN]')).toBe(false);
    expect(isSilentResponse('SILENT')).toBe(false);
  });
});

describe('processNoReplySentinel', () => {
  it('returns null when response is just NO_REPLY', () => {
    expect(processNoReplySentinel('NO_REPLY')).toBeNull();
    expect(processNoReplySentinel('  no_reply  ')).toBeNull();
  });

  it('returns null when response starts with NO_REPLY', () => {
    expect(processNoReplySentinel('NO_REPLY — sender blocked')).toBeNull();
  });

  it('strips trailing NO_REPLY line, keeps the actual reply', () => {
    expect(processNoReplySentinel('Hello! How can I help?\n\nNO_REPLY')).toBe('Hello! How can I help?');
    expect(processNoReplySentinel('Привет 😊\nNO_REPLY')).toBe('Привет 😊');
  });

  it('strips trailing NO_REPLY with extra commentary on the same line', () => {
    expect(processNoReplySentinel('Real reply\nNO_REPLY (end of turn)')).toBe('Real reply');
  });

  it('returns the original text when NO_REPLY is absent', () => {
    expect(processNoReplySentinel('Just a normal response.')).toBe('Just a normal response.');
  });

  it('does not match NO_REPLY embedded mid-response (only trailing line)', () => {
    expect(processNoReplySentinel('I would say NO_REPLY but actually here is help.'))
      .toBe('I would say NO_REPLY but actually here is help.');
  });
});

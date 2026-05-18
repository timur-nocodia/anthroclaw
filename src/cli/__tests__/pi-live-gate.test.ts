import { describe, expect, it } from 'vitest';
import {
  parsePiLiveGateArgs,
  runPiLiveGateCli,
  type PiLiveGateId,
} from '../pi-live-gate.js';

describe('Pi live gate dispatcher CLI', () => {
  it('parses gate id and forwards the remaining args untouched', () => {
    expect(parsePiLiveGateArgs([
      '--',
      '--gate', 'memory-read',
      '--agent-id', 'custom_agent',
      '--peer-id', '42',
      '--json',
    ])).toEqual({
      gate: 'memory-read',
      rest: ['--agent-id', 'custom_agent', '--peer-id', '42', '--json'],
      help: false,
    });
    expect(parsePiLiveGateArgs([
      '--gate=live-send-message',
      '--dry-run',
    ])).toMatchObject({
      gate: 'live-send-message',
      rest: ['--dry-run'],
    });
    expect(() => parsePiLiveGateArgs(['--gate', 'unknown'])).toThrow(/Unknown gate/);
  });

  it('dispatches to the selected gate runner', async () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const calls: Array<{ gate: PiLiveGateId; argv: string[] }> = [];

    const code = await runPiLiveGateCli([
      '--gate', 'live-send-message',
      '--agent-id', 'custom_agent',
      '--peer-id', '42',
      '--dry-run',
    ], {
      stdout,
      stderr,
      gateRunners: {
        'live-send-message': async (argv) => {
          calls.push({ gate: 'live-send-message', argv });
          return 0;
        },
      },
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toBe('');
    expect(calls).toEqual([{
      gate: 'live-send-message',
      argv: ['--agent-id', 'custom_agent', '--peer-id', '42', '--dry-run'],
    }]);
  });

  it('prints dispatcher help without requiring a gate', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLiveGateCli(['--help'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('memory-read');
    expect(stdout.text()).toContain('live-send-message');
  });

  it('returns usage error when gate is missing', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLiveGateCli(['--agent-id', 'custom_agent'], { stdout, stderr });

    expect(code).toBe(2);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('--gate is required');
  });
});

function createWriter() {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}

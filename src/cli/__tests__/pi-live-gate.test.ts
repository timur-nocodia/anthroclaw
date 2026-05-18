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
    ])).toMatchObject({
      gate: 'memory-read',
      rest: ['--agent-id', 'custom_agent', '--peer-id', '42', '--json'],
      help: false,
      json: true,
      list: false,
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

  it('prints a human-readable gate registry without requiring a gate', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLiveGateCli(['--list'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('live-send-message');
    expect(stdout.text()).toContain('runtime:pi-live-send-message-gate');
    expect(stdout.text()).toContain('external_write');
  });

  it('prints the gate registry as JSON for automation', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLiveGateCli(['--list', '--json'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const payload = JSON.parse(stdout.text()) as {
      status: string;
      gates: Array<{
        id: string;
        title: string;
        capabilityGroup: string;
        focusedCommand: string;
        aggregateDispatcher: boolean;
        execution: {
          requiredFlags: string[];
          safetyMode: string;
        };
      }>;
    };
    expect(payload.status).toBe('ok');
    expect(payload.gates.some((gate) => gate.id === 'memory-read')).toBe(true);
    expect(payload.gates.every((gate) => gate.aggregateDispatcher)).toBe(true);
    expect(payload.gates.find((gate) => gate.id === 'live-send-message')).toMatchObject({
      title: 'Live Send Message',
      capabilityGroup: 'messaging',
    });
    expect(payload.gates.find((gate) => gate.id === 'live-send-message')?.execution).toMatchObject({
      requiredFlags: ['agent-id', 'peer-id'],
      safetyMode: 'dry-run-first',
    });
  });

  it('describes one gate without requiring a run', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLiveGateCli(['--describe', 'memory-read'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('memory-read');
    expect(stdout.text()).toContain('Memory Read');
    expect(stdout.text()).toContain('group: memory');
    expect(stdout.text()).toContain('runtime:pi-memory-read-gate');
    expect(stdout.text()).toContain('not-required-read-only');
  });

  it('describes one gate as JSON for automation', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLiveGateCli(['--describe=live-send-message', '--json'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const payload = JSON.parse(stdout.text()) as {
      status: string;
      gate: {
        id: string;
        title: string;
        capabilityGroup: string;
        execution: {
          supportsDryRun: boolean;
          approval: string;
        };
      };
    };
    expect(payload.status).toBe('ok');
    expect(payload.gate.id).toBe('live-send-message');
    expect(payload.gate).toMatchObject({
      title: 'Live Send Message',
      capabilityGroup: 'messaging',
    });
    expect(payload.gate.execution).toMatchObject({
      supportsDryRun: true,
      approval: 'required-for-live',
    });
  });

  it('validates focused gate arguments without running the gate', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLiveGateCli([
      '--validate-args', 'live-send-media',
      '--agent-id', 'custom_agent',
      '--peer-id', '42',
      '--file-path', '/tmp/file.txt',
      '--allowed-file-root=/tmp',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const payload = JSON.parse(stdout.text()) as {
      status: string;
      gateId: string;
      missingFlags: string[];
    };
    expect(payload).toMatchObject({
      status: 'ok',
      gateId: 'live-send-media',
      missingFlags: [],
    });
  });

  it('reports missing required focused gate arguments', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLiveGateCli([
      '--validate-args=live-send-media',
      '--agent-id', 'custom_agent',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(2);
    expect(stderr.text()).toBe('');
    const payload = JSON.parse(stdout.text()) as {
      status: string;
      gateId: string;
      missingFlags: string[];
    };
    expect(payload).toMatchObject({
      status: 'failed',
      gateId: 'live-send-media',
      missingFlags: ['peer-id', 'file-path', 'allowed-file-root'],
    });
  });

  it('reports unknown focused gate arguments in strict validation mode', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLiveGateCli([
      '--validate-args', 'live-send-message',
      '--agent-id', 'custom_agent',
      '--peer-id', '42',
      '--weird-flag', 'value',
      '--strict',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(2);
    expect(stderr.text()).toBe('');
    const payload = JSON.parse(stdout.text()) as {
      status: string;
      missingFlags: string[];
      unknownFlags: string[];
    };
    expect(payload).toMatchObject({
      status: 'failed',
      missingFlags: [],
      unknownFlags: ['weird-flag'],
    });
  });

  it('ignores unknown focused gate arguments outside strict validation mode', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLiveGateCli([
      '--validate-args', 'live-send-message',
      '--agent-id', 'custom_agent',
      '--peer-id', '42',
      '--weird-flag', 'value',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const payload = JSON.parse(stdout.text()) as {
      status: string;
      unknownFlags: string[];
    };
    expect(payload).toMatchObject({
      status: 'ok',
      unknownFlags: [],
    });
  });

  it('returns usage error for an unknown described gate', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLiveGateCli(['--describe', 'unknown'], { stdout, stderr });

    expect(code).toBe(2);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('Unknown gate');
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

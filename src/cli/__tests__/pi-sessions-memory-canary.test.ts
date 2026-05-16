import { existsSync, rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parsePiSessionsMemoryCanaryArgs,
  runPiSessionsMemoryCanaryCli,
} from '../pi-sessions-memory-canary.js';

describe('Pi sessions/memory canary CLI', () => {
  it('runs the scripted sessions, memory, and learning canary', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiSessionsMemoryCanaryCli(['--json'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.sessions-memory-learning',
    });
    expect(body.workspacePath).toBeUndefined();
    expect(body.assertions).toMatchObject({
      recalledSessions: 1,
      title: 'Pi Runtime Memory Migration',
      learningActions: 1,
      reviewStatus: 'completed',
    });
    expect(body.assertions.memoryEntryPath).toContain('memory/learning/pi-canary-run-1/');
    expect(body.assertions.memoryHits).toBeGreaterThanOrEqual(1);
  });

  it('can keep the temporary workspace for inspection', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiSessionsMemoryCanaryCli(['--json', '--keep-workspace'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(typeof body.workspacePath).toBe('string');
    expect(existsSync(body.workspacePath)).toBe(true);
    rmSync(body.workspacePath, { recursive: true, force: true });
  });

  it('parses flags narrowly', () => {
    expect(parsePiSessionsMemoryCanaryArgs(['--', '--json', '--keep-workspace'])).toEqual({
      json: true,
      keepWorkspace: true,
      help: false,
    });
    expect(() => parsePiSessionsMemoryCanaryArgs(['--model', 'x'])).toThrow(/Unknown argument/);
  });
});

interface Writer {
  write(chunk: string): boolean;
}

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

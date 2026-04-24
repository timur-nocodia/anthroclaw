import { describe, it, expect } from 'vitest';
import { executeQuickCommand, matchQuickCommand } from '../../src/commands/quick.js';
import type { QuickCommand } from '../../src/commands/quick.js';

describe('executeQuickCommand', () => {
  it('executes simple echo command', () => {
    const result = executeQuickCommand({ command: 'echo hello', timeout: 30 });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBe('');
  });

  it('captures stdout', () => {
    const result = executeQuickCommand({ command: 'echo "line1" && echo "line2"', timeout: 30 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('line1');
    expect(result.stdout).toContain('line2');
  });

  it('handles non-zero exit code', () => {
    const result = executeQuickCommand({ command: 'exit 42', timeout: 30 });
    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  it('handles timeout', () => {
    const result = executeQuickCommand({ command: 'sleep 10', timeout: 1 });
    expect(result.timedOut).toBe(true);
  });
});

describe('matchQuickCommand', () => {
  const commands: Record<string, QuickCommand> = {
    status: { command: 'echo ok', timeout: 10 },
    deploy: { command: 'echo deploying', timeout: 60 },
  };

  it('matches a registered command', () => {
    const match = matchQuickCommand('/status', commands);
    expect(match).not.toBeNull();
    expect(match!.name).toBe('status');
    expect(match!.command).toEqual({ command: 'echo ok', timeout: 10 });
  });

  it('returns null for unregistered command', () => {
    const match = matchQuickCommand('/unknown', commands);
    expect(match).toBeNull();
  });

  it('returns null for message without leading /', () => {
    const match = matchQuickCommand('status', commands);
    expect(match).toBeNull();
  });

  it('matches command ignoring trailing text', () => {
    const match = matchQuickCommand('/deploy now', commands);
    expect(match).not.toBeNull();
    expect(match!.name).toBe('deploy');
  });
});

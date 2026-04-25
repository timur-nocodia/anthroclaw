import { describe, expect, it } from 'vitest';
import {
  evaluateFileOwnershipToolUse,
  extractWritePath,
} from '../../src/sdk/file-ownership-permissions.js';
import { FileOwnershipRegistry } from '../../src/sdk/file-ownership.js';

describe('file ownership permission evaluator', () => {
  it('extracts normalized write paths from SDK write tools', () => {
    expect(extractWritePath('Write', { file_path: 'src/app.ts' }, '/repo'))
      .toBe('/repo/src/app.ts');
    expect(extractWritePath('Edit', { path: '/repo/src/app.ts' }, '/other'))
      .toBe('/repo/src/app.ts');
    expect(extractWritePath('NotebookEdit', { notebook_path: 'notes.ipynb' }, '/repo'))
      .toBe('/repo/notes.ipynb');
    expect(extractWritePath('Read', { file_path: 'src/app.ts' }, '/repo'))
      .toBeUndefined();
  });

  it('allows and claims non-conflicting write tool use', () => {
    const registry = new FileOwnershipRegistry();
    const decision = evaluateFileOwnershipToolUse(registry, {
      sessionKey: 'session-1',
      runId: 'run-a',
      subagentId: 'coder-a',
      toolName: 'Write',
      toolInput: { file_path: 'src/app.ts' },
      cwd: '/repo',
      conflictMode: 'strict',
    }, 1000);

    expect(decision).toMatchObject({
      applies: true,
      allowed: true,
      path: '/repo/src/app.ts',
      conflicts: [],
    });
    expect(decision.claim).toMatchObject({
      path: '/repo/src/app.ts',
      subagentId: 'coder-a',
    });
  });

  it('denies conflicting sibling writes in strict mode', () => {
    const registry = new FileOwnershipRegistry();
    evaluateFileOwnershipToolUse(registry, {
      sessionKey: 'session-1',
      runId: 'run-a',
      subagentId: 'coder-a',
      toolName: 'Write',
      toolInput: { file_path: 'src/app.ts' },
      cwd: '/repo',
      conflictMode: 'strict',
    }, 1000);

    const decision = evaluateFileOwnershipToolUse(registry, {
      sessionKey: 'session-1',
      runId: 'run-b',
      subagentId: 'coder-b',
      toolName: 'Edit',
      toolInput: { file_path: './src/app.ts' },
      cwd: '/repo',
      conflictMode: 'strict',
    }, 1001);

    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain('denied coder-b/run-b');
    expect(decision.conflicts[0]).toMatchObject({
      action: 'deny',
      existing: { subagentId: 'coder-a' },
      requested: { subagentId: 'coder-b' },
    });
  });

  it('warns but allows conflicting sibling writes in soft mode', () => {
    const registry = new FileOwnershipRegistry();
    evaluateFileOwnershipToolUse(registry, {
      sessionKey: 'session-1',
      runId: 'run-a',
      subagentId: 'coder-a',
      toolName: 'Write',
      toolInput: { file_path: 'src/app.ts' },
      cwd: '/repo',
      conflictMode: 'soft',
    }, 1000);

    const decision = evaluateFileOwnershipToolUse(registry, {
      sessionKey: 'session-1',
      runId: 'run-b',
      subagentId: 'coder-b',
      toolName: 'MultiEdit',
      toolInput: { file_path: 'src/app.ts' },
      cwd: '/repo',
      conflictMode: 'soft',
    }, 1001);

    expect(decision.allowed).toBe(true);
    expect(decision.message).toContain('conflict recorded');
    expect(decision.conflicts[0]).toMatchObject({ action: 'allow' });
    expect(registry.listClaims({ path: '/repo/src/app.ts' }, 1002)).toHaveLength(2);
  });

  it('does not apply to non-write tools or missing paths', () => {
    const registry = new FileOwnershipRegistry();

    expect(evaluateFileOwnershipToolUse(registry, {
      sessionKey: 'session-1',
      runId: 'run-a',
      subagentId: 'coder-a',
      toolName: 'Read',
      toolInput: { file_path: 'src/app.ts' },
      cwd: '/repo',
    })).toMatchObject({ applies: false, allowed: true });

    expect(evaluateFileOwnershipToolUse(registry, {
      sessionKey: 'session-1',
      runId: 'run-a',
      subagentId: 'coder-a',
      toolName: 'Write',
      toolInput: {},
      cwd: '/repo',
    })).toMatchObject({ applies: false, allowed: true });
  });
});

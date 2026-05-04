import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentWorkspaceDir, siblingAgentDirs } from '../agent-workspace.js';

let dir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sandbox-test-'));
  mkdirSync(join(dir, 'agentA'));
  mkdirSync(join(dir, 'agentB'));
  mkdirSync(join(dir, 'agentC'));
  prevEnv = process.env.OC_AGENTS_DIR;
  process.env.OC_AGENTS_DIR = dir;
});
afterEach(() => {
  process.env.OC_AGENTS_DIR = prevEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe('agentWorkspaceDir', () => {
  it('returns absolute path under OC_AGENTS_DIR', () => {
    expect(agentWorkspaceDir({ id: 'agentA' } as any)).toBe(join(dir, 'agentA'));
  });

  it('returns absolute path even when OC_AGENTS_DIR is relative — resolves to absolute', () => {
    process.env.OC_AGENTS_DIR = './tmp-relative';
    const out = agentWorkspaceDir({ id: 'agentA' } as any);
    expect(out.startsWith('/')).toBe(true);
    expect(out.endsWith('/tmp-relative/agentA')).toBe(true);
  });

  it('falls back to cwd/agents when OC_AGENTS_DIR is unset', () => {
    delete process.env.OC_AGENTS_DIR;
    const out = agentWorkspaceDir({ id: 'agentA' } as any);
    expect(out.endsWith('/agents/agentA')).toBe(true);
  });

  it('rejects path traversal in agent id', () => {
    expect(() => agentWorkspaceDir({ id: '../etc' } as any)).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir({ id: '..' } as any)).toThrow(/invalid/i);
  });

  it('rejects slashes in agent id', () => {
    expect(() => agentWorkspaceDir({ id: 'foo/bar' } as any)).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir({ id: 'foo\\bar' } as any)).toThrow(/invalid/i);
  });

  it('rejects empty id', () => {
    expect(() => agentWorkspaceDir({ id: '' } as any)).toThrow(/invalid/i);
  });

  it('rejects id starting with non-alphanumeric', () => {
    expect(() => agentWorkspaceDir({ id: '-leading' } as any)).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir({ id: '_leading' } as any)).toThrow(/invalid/i);
  });

  it('rejects id over 64 chars', () => {
    expect(() => agentWorkspaceDir({ id: 'a'.repeat(65) } as any)).toThrow(/invalid/i);
  });

  it('accepts id with allowed characters (lowercase alphanumeric, _, -)', () => {
    expect(() => agentWorkspaceDir({ id: 'a' } as any)).not.toThrow();
    expect(() => agentWorkspaceDir({ id: 'a1' } as any)).not.toThrow();
    expect(() => agentWorkspaceDir({ id: 'a_b' } as any)).not.toThrow();
    expect(() => agentWorkspaceDir({ id: 'a-b' } as any)).not.toThrow();
    expect(() => agentWorkspaceDir({ id: 'a1-b_c-9' } as any)).not.toThrow();
  });

  it('rejects id with uppercase letters', () => {
    expect(() => agentWorkspaceDir({ id: 'AgentA' } as any)).toThrow(/invalid/i);
  });
});

describe('siblingAgentDirs', () => {
  it('returns absolute paths of all agents EXCEPT current', () => {
    const siblings = siblingAgentDirs('agentA').sort();
    expect(siblings).toEqual([join(dir, 'agentB'), join(dir, 'agentC')].sort());
  });

  it('returns [] when current is the only agent', () => {
    rmSync(join(dir, 'agentB'), { recursive: true });
    rmSync(join(dir, 'agentC'), { recursive: true });
    expect(siblingAgentDirs('agentA')).toEqual([]);
  });

  it('returns [] when agents root does not exist', () => {
    process.env.OC_AGENTS_DIR = '/tmp/does-not-exist-' + Math.random();
    expect(siblingAgentDirs('agentA')).toEqual([]);
  });

  it('skips entries with invalid agent-id format', () => {
    mkdirSync(join(dir, 'NotAnAgent'));
    mkdirSync(join(dir, 'agent valid name has space'));
    writeFileSync(join(dir, '.hidden'), 'x');
    const siblings = siblingAgentDirs('agentA').sort();
    expect(siblings).toEqual([join(dir, 'agentB'), join(dir, 'agentC')].sort());
  });

  it('skips files (only directories)', () => {
    writeFileSync(join(dir, 'fakeagent'), 'x');
    const siblings = siblingAgentDirs('agentA').sort();
    expect(siblings).toEqual([join(dir, 'agentB'), join(dir, 'agentC')].sort());
  });
});

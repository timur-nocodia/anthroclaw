import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentWorkspaceDir, siblingAgentDirs } from '../agent-workspace.js';

let dir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sandbox-test-'));
  mkdirSync(join(dir, 'agent_a'));
  mkdirSync(join(dir, 'agent_b'));
  mkdirSync(join(dir, 'agent_c'));
  prevEnv = process.env.OC_AGENTS_DIR;
  process.env.OC_AGENTS_DIR = dir;
});
afterEach(() => {
  process.env.OC_AGENTS_DIR = prevEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe('agentWorkspaceDir', () => {
  it('returns absolute path under OC_AGENTS_DIR', () => {
    expect(agentWorkspaceDir({ id: 'agent_a' } as any)).toBe(join(dir, 'agent_a'));
  });

  it('returns absolute path even when OC_AGENTS_DIR is relative — resolves to absolute', () => {
    process.env.OC_AGENTS_DIR = './tmp-relative';
    const out = agentWorkspaceDir({ id: 'agent_a' } as any);
    expect(out.startsWith('/')).toBe(true);
    expect(out.endsWith('/tmp-relative/agent_a')).toBe(true);
  });

  it('falls back to cwd/agents when OC_AGENTS_DIR is unset', () => {
    delete process.env.OC_AGENTS_DIR;
    const out = agentWorkspaceDir({ id: 'agent_a' } as any);
    expect(out.endsWith('/agents/agent_a')).toBe(true);
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

  it('rejects mixed-case ids — canonical agent-id form is lowercase only', () => {
    expect(() => agentWorkspaceDir({ id: 'AgentA' } as any)).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir({ id: 'agentA' } as any)).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir({ id: 'AGENT_A' } as any)).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir({ id: 'aGeNt_a' } as any)).toThrow(/invalid/i);
  });
});

describe('siblingAgentDirs', () => {
  it('returns absolute paths of all agents EXCEPT current', () => {
    const siblings = siblingAgentDirs('agent_a').sort();
    expect(siblings).toEqual([join(dir, 'agent_b'), join(dir, 'agent_c')].sort());
  });

  it('returns [] when current is the only agent', () => {
    rmSync(join(dir, 'agent_b'), { recursive: true });
    rmSync(join(dir, 'agent_c'), { recursive: true });
    expect(siblingAgentDirs('agent_a')).toEqual([]);
  });

  it('returns [] when agents root does not exist', () => {
    process.env.OC_AGENTS_DIR = '/tmp/does-not-exist-' + Math.random();
    expect(siblingAgentDirs('agent_a')).toEqual([]);
  });

  it('skips entries with invalid agent-id format', () => {
    mkdirSync(join(dir, 'NotAnAgent'));
    mkdirSync(join(dir, 'agent valid name has space'));
    mkdirSync(join(dir, 'AgentMixedCase'));
    writeFileSync(join(dir, '.hidden'), 'x');
    const siblings = siblingAgentDirs('agent_a').sort();
    expect(siblings).toEqual([join(dir, 'agent_b'), join(dir, 'agent_c')].sort());
  });

  it('skips files (only directories)', () => {
    writeFileSync(join(dir, 'fakeagent'), 'x');
    const siblings = siblingAgentDirs('agent_a').sort();
    expect(siblings).toEqual([join(dir, 'agent_b'), join(dir, 'agent_c')].sort());
  });
});

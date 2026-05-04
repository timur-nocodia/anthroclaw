import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AGENT_ID_MAX_LEN,
  AGENT_ID_RE,
  agentWorkspaceDir,
  siblingAgentDirs,
} from '../agent-workspace.js';

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
    expect(agentWorkspaceDir('agent_a')).toBe(join(dir, 'agent_a'));
  });

  it('returns absolute path even when OC_AGENTS_DIR is relative — resolves to absolute', () => {
    process.env.OC_AGENTS_DIR = './tmp-relative';
    const out = agentWorkspaceDir('agent_a');
    expect(out.startsWith('/')).toBe(true);
    expect(out.endsWith('/tmp-relative/agent_a')).toBe(true);
  });

  it('falls back to cwd/agents when OC_AGENTS_DIR is unset', () => {
    delete process.env.OC_AGENTS_DIR;
    const out = agentWorkspaceDir('agent_a');
    expect(out.endsWith('/agents/agent_a')).toBe(true);
  });

  it('rejects path traversal in agent id', () => {
    expect(() => agentWorkspaceDir('../etc')).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir('..')).toThrow(/invalid/i);
  });

  it('rejects slashes in agent id', () => {
    expect(() => agentWorkspaceDir('foo/bar')).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir('foo\\bar')).toThrow(/invalid/i);
  });

  it('rejects empty id', () => {
    expect(() => agentWorkspaceDir('')).toThrow(/invalid/i);
  });

  it('rejects id starting with non-alphanumeric', () => {
    expect(() => agentWorkspaceDir('-leading')).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir('_leading')).toThrow(/invalid/i);
  });

  it('rejects id over 64 chars', () => {
    expect(() => agentWorkspaceDir('a'.repeat(65))).toThrow(/invalid/i);
  });

  it('accepts id with allowed characters (lowercase alphanumeric, _, -)', () => {
    expect(() => agentWorkspaceDir('a')).not.toThrow();
    expect(() => agentWorkspaceDir('a1')).not.toThrow();
    expect(() => agentWorkspaceDir('a_b')).not.toThrow();
    expect(() => agentWorkspaceDir('a-b')).not.toThrow();
    expect(() => agentWorkspaceDir('a1-b_c-9')).not.toThrow();
  });

  it('rejects mixed-case ids — canonical agent-id form is lowercase only', () => {
    expect(() => agentWorkspaceDir('AgentA')).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir('agentA')).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir('AGENT_A')).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir('aGeNt_a')).toThrow(/invalid/i);
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

  it('skips dir with single uppercase letter', () => {
    mkdirSync(join(dir, 'agentB')); // single defect: lowercase + uppercase mix
    expect(siblingAgentDirs('agent_a')).not.toContain(join(dir, 'agentB'));
  });

  it('skips dir with dot', () => {
    mkdirSync(join(dir, 'agent.dot'));
    expect(siblingAgentDirs('agent_a')).not.toContain(join(dir, 'agent.dot'));
  });

  it('skips dir starting with dot', () => {
    mkdirSync(join(dir, '.agent'));
    expect(siblingAgentDirs('agent_a')).not.toContain(join(dir, '.agent'));
  });

  it('skips dir with leading digit OK; rejects leading hyphen', () => {
    mkdirSync(join(dir, '9agent'));
    mkdirSync(join(dir, '-agent'));
    const siblings = siblingAgentDirs('agent_a');
    expect(siblings).toContain(join(dir, '9agent')); // leading digit IS valid
    expect(siblings).not.toContain(join(dir, '-agent')); // leading hyphen NOT valid
  });

  it('skips files (only directories)', () => {
    writeFileSync(join(dir, 'fakeagent'), 'x');
    const siblings = siblingAgentDirs('agent_a').sort();
    expect(siblings).toEqual([join(dir, 'agent_b'), join(dir, 'agent_c')].sort());
  });

  it('does not treat symlinks as agent directories', () => {
    // Create a target dir outside agents-root
    const externalDir = mkdtempSync(join(tmpdir(), 'sym-target-'));
    try {
      symlinkSync(externalDir, join(dir, 'sym_evil'));
      // sym_evil passes the regex — it's a valid-looking name
      const siblings = siblingAgentDirs('agent_a');
      expect(siblings.some((p) => p.endsWith('sym_evil'))).toBe(false);
    } finally {
      rmSync(externalDir, { recursive: true, force: true });
    }
  });
});

describe('exported constants for cross-module reuse', () => {
  it('exports AGENT_ID_RE matching the canonical regex', () => {
    expect(AGENT_ID_RE.test('agent_a')).toBe(true);
    expect(AGENT_ID_RE.test('AgentA')).toBe(false);
    expect(AGENT_ID_RE.test('')).toBe(false);
  });
  it('exports AGENT_ID_MAX_LEN as 64', () => {
    expect(AGENT_ID_MAX_LEN).toBe(64);
  });
});

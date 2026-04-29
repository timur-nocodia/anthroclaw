import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

let TEMP_DIR: string;
let agentsModule: typeof import('@/lib/agents');

beforeEach(async () => {
  TEMP_DIR = join(tmpdir(), `agents-default-test-${randomUUID()}`);
  mkdirSync(TEMP_DIR, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(join(TEMP_DIR, 'ui'));
  mkdirSync(join(TEMP_DIR, 'ui'), { recursive: true });
  mkdirSync(join(TEMP_DIR, 'agents'), { recursive: true });
  vi.resetModules();
  agentsModule = await import('@/lib/agents');
});

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
});

function readAgentYml(id: string): Record<string, unknown> {
  const raw = readFileSync(join(TEMP_DIR, 'agents', id, 'agent.yml'), 'utf-8');
  return parseYaml(raw) as Record<string, unknown>;
}

describe('createAgent default safety_profile', () => {
  it('blank template writes safety_profile: chat_like_openclaw', () => {
    agentsModule.createAgent('blank-test', undefined, 'blank');
    const config = readAgentYml('blank-test');
    expect(config.safety_profile).toBe('chat_like_openclaw');
  });

  it('example template writes safety_profile: chat_like_openclaw', () => {
    agentsModule.createAgent('example-test', 'claude-opus-4-6', 'example');
    const config = readAgentYml('example-test');
    expect(config.safety_profile).toBe('chat_like_openclaw');
  });

  it('blank template includes routes', () => {
    agentsModule.createAgent('blank-test', undefined, 'blank');
    const config = readAgentYml('blank-test') as { routes: unknown };
    expect(Array.isArray(config.routes)).toBe(true);
  });
});

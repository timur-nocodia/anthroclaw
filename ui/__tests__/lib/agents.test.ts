import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { stringify as stringifyYaml } from 'yaml';

// We need to mock the AGENTS_DIR before importing the module
let TEMP_DIR: string;
let agentsModule: typeof import('@/lib/agents');

beforeEach(async () => {
  TEMP_DIR = join(tmpdir(), `agents-test-${randomUUID()}`);
  mkdirSync(TEMP_DIR, { recursive: true });

  // Mock process.cwd() so AGENTS_DIR resolves to our temp dir
  vi.spyOn(process, 'cwd').mockReturnValue(join(TEMP_DIR, 'ui'));
  mkdirSync(join(TEMP_DIR, 'ui'), { recursive: true });
  mkdirSync(join(TEMP_DIR, 'agents'), { recursive: true });

  // Re-import to pick up the mocked cwd
  vi.resetModules();
  agentsModule = await import('@/lib/agents');
});

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  }
});

function agentsDir() {
  return join(TEMP_DIR, 'agents');
}

function createTestAgent(id: string, config?: Record<string, unknown>) {
  const dir = join(agentsDir(), id);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'memory'), { recursive: true });
  mkdirSync(join(dir, '.claude', 'skills'), { recursive: true });

  const agentConfig = config ?? {
    model: 'claude-sonnet-4-6',
    routes: [{ channel: 'telegram', scope: 'dm' }],
  };
  writeFileSync(join(dir, 'agent.yml'), stringifyYaml(agentConfig), 'utf-8');
  writeFileSync(join(dir, 'CLAUDE.md'), `# ${id}\n`, 'utf-8');
  return dir;
}

describe('listAgents', () => {
  it('returns empty array when no agents exist', () => {
    const agents = agentsModule.listAgents();
    expect(agents).toEqual([]);
  });

  it('lists multiple agents', () => {
    createTestAgent('agent-a');
    createTestAgent('agent-b', {
      model: 'claude-opus-4',
      routes: [
        { channel: 'telegram', scope: 'dm' },
        { channel: 'whatsapp', scope: 'any' },
      ],
    });

    const agents = agentsModule.listAgents();
    expect(agents).toHaveLength(2);

    const a = agents.find((x) => x.id === 'agent-a');
    expect(a).toBeDefined();
    expect(a!.model).toBe('claude-sonnet-4-6');
    expect(a!.routes).toHaveLength(1);
    expect(a!.hasClaudeMd).toBe(true);

    const b = agents.find((x) => x.id === 'agent-b');
    expect(b).toBeDefined();
    expect(b!.model).toBe('claude-opus-4');
    expect(b!.routes).toHaveLength(2);
  });
});

describe('createAgent', () => {
  it('creates directory with agent.yml, CLAUDE.md, memory, .claude/skills', () => {
    agentsModule.createAgent('my-bot');

    const dir = join(agentsDir(), 'my-bot');
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, 'agent.yml'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(dir, 'memory'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'skills'))).toBe(true);
  });

  it('creates example template with mcp_tools', () => {
    agentsModule.createAgent('example-bot', 'claude-opus-4', 'example');

    const raw = readFileSync(join(agentsDir(), 'example-bot', 'agent.yml'), 'utf-8');
    expect(raw).toContain('claude-opus-4');
    expect(raw).toContain('memory_search');
  });

  it('rejects invalid ID', () => {
    expect(() => agentsModule.createAgent('Invalid ID!')).toThrow(agentsModule.ValidationError);
    expect(() => agentsModule.createAgent('-starts-with-dash')).toThrow(agentsModule.ValidationError);
    expect(() => agentsModule.createAgent('')).toThrow(agentsModule.ValidationError);
  });

  it('rejects duplicate ID', () => {
    agentsModule.createAgent('my-bot');
    expect(() => agentsModule.createAgent('my-bot')).toThrow(agentsModule.ValidationError);
  });
});

describe('deleteAgent', () => {
  it('removes agent directory', () => {
    createTestAgent('to-delete');
    expect(existsSync(join(agentsDir(), 'to-delete'))).toBe(true);

    agentsModule.deleteAgent('to-delete');
    expect(existsSync(join(agentsDir(), 'to-delete'))).toBe(false);
  });

  it('throws NotFoundError for non-existent agent', () => {
    expect(() => agentsModule.deleteAgent('nope')).toThrow(agentsModule.NotFoundError);
  });
});

describe('getAgentConfig', () => {
  it('returns raw YAML and parsed object', () => {
    createTestAgent('cfg-test', {
      model: 'claude-opus-4',
      routes: [{ channel: 'telegram', scope: 'dm' }],
    });

    const result = agentsModule.getAgentConfig('cfg-test');
    expect(result.raw).toContain('claude-opus-4');
    expect(result.parsed.model).toBe('claude-opus-4');
    expect(Array.isArray(result.parsed.routes)).toBe(true);
  });

  it('throws NotFoundError for missing agent', () => {
    expect(() => agentsModule.getAgentConfig('nope')).toThrow(agentsModule.NotFoundError);
  });
});

describe('updateAgentConfig', () => {
  it('writes valid YAML', () => {
    createTestAgent('update-test');

    const newYaml = stringifyYaml({
      model: 'claude-opus-4',
      safety_profile: 'trusted',
      routes: [{ channel: 'whatsapp', scope: 'any' }],
    });

    agentsModule.updateAgentConfig('update-test', newYaml);

    const result = agentsModule.getAgentConfig('update-test');
    expect(result.parsed.model).toBe('claude-opus-4');
  });

  it('rejects invalid YAML syntax', () => {
    createTestAgent('invalid-yaml');
    expect(() => agentsModule.updateAgentConfig('invalid-yaml', '{{{{invalid')).toThrow(
      agentsModule.ValidationError,
    );
  });

  it('rejects YAML that fails schema validation', () => {
    createTestAgent('schema-fail');
    // Missing required 'routes' field
    const badConfig = stringifyYaml({ model: 'test' });
    expect(() => agentsModule.updateAgentConfig('schema-fail', badConfig)).toThrow(
      agentsModule.ValidationError,
    );
  });
});

describe('setAgentLearningConfig', () => {
  it('updates only learning config and keeps the rest of agent.yml valid', () => {
    createTestAgent('learning-test', {
      model: 'claude-sonnet-4-6',
      safety_profile: 'private',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      learning: { enabled: false, mode: 'off' },
      mcp_tools: ['memory_search'],
    });

    agentsModule.setAgentLearningConfig('learning-test', {
      enabled: true,
      mode: 'propose',
      review_interval_turns: 10,
      skill_review_min_tool_calls: 8,
      max_actions_per_review: 8,
      max_input_chars: 24000,
      artifacts: {
        max_files: 32,
        max_file_bytes: 65536,
        max_total_bytes: 262144,
        max_prompt_chars: 24000,
        max_snippet_chars: 4000,
      },
    });

    const result = agentsModule.getAgentConfig('learning-test');
    expect(result.parsed.model).toBe('claude-sonnet-4-6');
    expect(result.parsed.mcp_tools).toEqual(['memory_search']);
    expect(result.parsed.learning).toMatchObject({
      enabled: true,
      mode: 'propose',
      review_interval_turns: 10,
    });
  });
});

describe('file CRUD', () => {
  it('listAgentFiles returns files in agent directory', () => {
    const dir = createTestAgent('file-test');
    writeFileSync(join(dir, 'soul.md'), 'test soul', 'utf-8');

    const files = agentsModule.listAgentFiles('file-test');
    const names = files.map((f) => f.name);
    expect(names).toContain('agent.yml');
    expect(names).toContain('CLAUDE.md');
    expect(names).toContain('soul.md');
    // Should not include directories
    expect(names).not.toContain('memory');
    expect(names).not.toContain('skills');
  });

  it('getAgentFile returns content and metadata', () => {
    const dir = createTestAgent('file-get');
    writeFileSync(join(dir, 'notes.md'), 'hello world', 'utf-8');

    const file = agentsModule.getAgentFile('file-get', 'notes.md');
    expect(file.name).toBe('notes.md');
    expect(file.content).toBe('hello world');
    expect(file.updatedAt).toBeDefined();
  });

  it('getAgentFile throws NotFoundError for missing file', () => {
    createTestAgent('file-missing');
    expect(() => agentsModule.getAgentFile('file-missing', 'nope.md')).toThrow(
      agentsModule.NotFoundError,
    );
  });

  it('writeAgentFile creates or overwrites file', () => {
    createTestAgent('file-write');
    agentsModule.writeAgentFile('file-write', 'new-file.md', 'new content');

    const dir = join(agentsDir(), 'file-write');
    expect(readFileSync(join(dir, 'new-file.md'), 'utf-8')).toBe('new content');

    // Overwrite
    agentsModule.writeAgentFile('file-write', 'new-file.md', 'updated');
    expect(readFileSync(join(dir, 'new-file.md'), 'utf-8')).toBe('updated');
  });

  it('deleteAgentFile removes file', () => {
    const dir = createTestAgent('file-del');
    writeFileSync(join(dir, 'temp.md'), 'temp', 'utf-8');

    agentsModule.deleteAgentFile('file-del', 'temp.md');
    expect(existsSync(join(dir, 'temp.md'))).toBe(false);
  });

  it('deleteAgentFile rejects CLAUDE.md', () => {
    createTestAgent('file-protected');
    expect(() => agentsModule.deleteAgentFile('file-protected', 'CLAUDE.md')).toThrow(
      agentsModule.ValidationError,
    );
  });

  it('deleteAgentFile throws NotFoundError for missing file', () => {
    createTestAgent('file-del-missing');
    expect(() => agentsModule.deleteAgentFile('file-del-missing', 'nope.txt')).toThrow(
      agentsModule.NotFoundError,
    );
  });
});

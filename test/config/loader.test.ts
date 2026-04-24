import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  substituteEnvVars,
  loadGlobalConfig,
  loadAgentYml,
} from '../../src/config/loader.js';

// ─── substituteEnvVars ────────────────────────────────────────────

describe('substituteEnvVars', () => {
  it('replaces ${VAR} with env value', () => {
    process.env.TEST_LOADER_VAR = 'hello';
    expect(substituteEnvVars('value is ${TEST_LOADER_VAR}')).toBe('value is hello');
    delete process.env.TEST_LOADER_VAR;
  });

  it('unset vars become empty string', () => {
    delete process.env.TOTALLY_UNSET_VAR_12345;
    expect(substituteEnvVars('before ${TOTALLY_UNSET_VAR_12345} after')).toBe('before  after');
  });

  it('leaves text without vars unchanged', () => {
    expect(substituteEnvVars('no variables here')).toBe('no variables here');
  });

  it('handles multiple vars in one string', () => {
    process.env.TEST_A = 'alpha';
    process.env.TEST_B = 'beta';
    expect(substituteEnvVars('${TEST_A} and ${TEST_B}')).toBe('alpha and beta');
    delete process.env.TEST_A;
    delete process.env.TEST_B;
  });
});

// ─── loadGlobalConfig ─────────────────────────────────────────────

describe('loadGlobalConfig', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads and validates valid config.yml', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'loader-test-'));
    const configPath = join(tmpDir, 'config.yml');
    writeFileSync(
      configPath,
      `
telegram:
  accounts:
    main:
      token: "bot123:ABC"
defaults:
  model: claude-opus-4-6
`,
    );

    const config = loadGlobalConfig(configPath);
    expect(config.telegram!.accounts.main.token).toBe('bot123:ABC');
    expect(config.defaults.model).toBe('claude-opus-4-6');
  });

  it('substitutes env vars in YAML before parsing', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'loader-test-'));
    const configPath = join(tmpDir, 'config.yml');
    process.env.TEST_BOT_TOKEN = 'secret-token-999';
    writeFileSync(
      configPath,
      `
telegram:
  accounts:
    main:
      token: "\${TEST_BOT_TOKEN}"
`,
    );

    const config = loadGlobalConfig(configPath);
    expect(config.telegram!.accounts.main.token).toBe('secret-token-999');
    delete process.env.TEST_BOT_TOKEN;
  });

  it('throws on invalid config (missing required fields)', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'loader-test-'));
    const configPath = join(tmpDir, 'config.yml');
    // embedding_provider must be 'openai' | 'local' | 'off'
    writeFileSync(
      configPath,
      `
defaults:
  embedding_provider: "bad_value"
`,
    );

    expect(() => loadGlobalConfig(configPath)).toThrow();
  });

  it('throws on nonexistent file', () => {
    expect(() => loadGlobalConfig('/tmp/does-not-exist-loader-test.yml')).toThrow();
  });
});

// ─── loadAgentYml ─────────────────────────────────────────────────

describe('loadAgentYml', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads agent.yml from directory', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'loader-test-'));
    writeFileSync(
      join(tmpDir, 'agent.yml'),
      `
routes:
  - channel: telegram
    scope: dm
`,
    );

    const agent = loadAgentYml(tmpDir);
    expect(agent.routes).toHaveLength(1);
    expect(agent.routes[0].channel).toBe('telegram');
    expect(agent.routes[0].scope).toBe('dm');
  });

  it('throws on missing agent.yml', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'loader-test-'));
    expect(() => loadAgentYml(tmpDir)).toThrow();
  });
});

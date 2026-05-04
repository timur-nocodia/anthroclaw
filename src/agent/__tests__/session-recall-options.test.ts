/**
 * Tests for buildSessionRecallSdkOptions — the SDK Options builder used by
 * summarizeSessionRecallWithSdk. The summarizer denies all tools via
 * canUseTool, but the SDK's .mcp.json discovery (driven by settingSources)
 * still fires at startup. Without hardening, that path can connect external
 * MCP servers and leak operator credentials via process.env.
 *
 * These tests guard the four-field hardening (settingSources,
 * additionalDirectories, env scrub, plus the existing canUseTool deny).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSessionRecallSdkOptions } from '../agent.js';
import type { AgentYml } from '../../config/schema.js';

function stubConfig(): AgentYml {
  return { model: 'claude-sonnet-4-6' } as unknown as AgentYml;
}

describe('buildSessionRecallSdkOptions', () => {
  let prev: Record<string, string | undefined>;

  beforeEach(() => {
    prev = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID,
      ANTHROCLAW_MASTER_KEY: process.env.ANTHROCLAW_MASTER_KEY,
      TZ: process.env.TZ,
    };
    process.env.ANTHROPIC_API_KEY = 'leak-anthropic';
    process.env.GOOGLE_CALENDAR_ID = 'leak-calendar';
    process.env.ANTHROCLAW_MASTER_KEY = 'leak-master';
    process.env.TZ = 'Etc/UTC';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('forces settingSources to [] (no .mcp.json discovery)', () => {
    const opts = buildSessionRecallSdkOptions(stubConfig(), '/workspace');
    expect(opts.settingSources).toEqual([]);
  });

  it('forces additionalDirectories to [] (no upward filesystem access)', () => {
    const opts = buildSessionRecallSdkOptions(stubConfig(), '/workspace');
    expect(opts.additionalDirectories).toEqual([]);
  });

  it('scrubs env: denylisted GOOGLE_CALENDAR_ID is NOT present', () => {
    const opts = buildSessionRecallSdkOptions(stubConfig(), '/workspace');
    expect(opts.env).toBeDefined();
    expect(opts.env?.GOOGLE_CALENDAR_ID).toBeUndefined();
  });

  it('scrubs env: denylisted ANTHROPIC_API_KEY is NOT present', () => {
    const opts = buildSessionRecallSdkOptions(stubConfig(), '/workspace');
    expect(opts.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('scrubs env: denylisted ANTHROCLAW_MASTER_KEY is NOT present', () => {
    const opts = buildSessionRecallSdkOptions(stubConfig(), '/workspace');
    expect(opts.env?.ANTHROCLAW_MASTER_KEY).toBeUndefined();
  });

  it('preserves harmless env vars (TZ)', () => {
    const opts = buildSessionRecallSdkOptions(stubConfig(), '/workspace');
    expect(opts.env?.TZ).toBe('Etc/UTC');
  });

  it('preserves the deny-all canUseTool semantics', async () => {
    const opts = buildSessionRecallSdkOptions(stubConfig(), '/workspace');
    expect(typeof opts.canUseTool).toBe('function');
    const r = await opts.canUseTool!('Read', {}, {} as any);
    expect(r.behavior).toBe('deny');
  });

  it('still configures cwd, model, maxTurns, persistSession, systemPrompt', () => {
    const opts = buildSessionRecallSdkOptions(stubConfig(), '/workspace');
    expect(opts.cwd).toBe('/workspace');
    expect(opts.model).toBe('claude-sonnet-4-6');
    expect(opts.maxTurns).toBe(1);
    expect(opts.persistSession).toBe(false);
    expect(opts.systemPrompt).toMatchObject({
      type: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: true,
    });
  });

  it('falls back to claude-sonnet-4-6 when config.model is undefined', () => {
    const opts = buildSessionRecallSdkOptions({} as AgentYml, '/workspace');
    expect(opts.model).toBe('claude-sonnet-4-6');
  });
});

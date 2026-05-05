import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSdkOptions } from '../options.js';
import { CHAT_PERSONALITY_BASELINE } from '../../security/profiles/chat-personality-baseline.js';
import { chatLikeOpenclawProfile } from '../../security/profiles/chat-like-openclaw.js';
import type { Agent } from '../../agent/agent.js';

function makeAgentStub(opts: {
  workspaceDir: string;
  personality?: string;
  claudeMd?: string;
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; handler: () => Promise<any> }>;
}): Agent {
  if (opts.claudeMd !== undefined) {
    writeFileSync(join(opts.workspaceDir, 'CLAUDE.md'), opts.claudeMd, 'utf-8');
  }
  return {
    id: 'test-agent',
    workspacePath: opts.workspaceDir,
    safetyProfile: chatLikeOpenclawProfile,
    config: {
      model: 'claude-sonnet-4-6',
      personality: opts.personality,
      sdk: undefined,
    },
    mcpServer: { name: 'test-tools' },
    tools: opts.tools ?? [],
  } as unknown as Agent;
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'options-chat-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('buildSdkOptions on chat profile', () => {
  it('uses string systemPrompt (not preset)', () => {
    const agent = makeAgentStub({ workspaceDir: tmpRoot, claudeMd: '# test' });
    const options = buildSdkOptions({ agent });
    expect(typeof options.systemPrompt).toBe('string');
  });

  it('systemPrompt includes baseline + CLAUDE.md when no personality override', () => {
    const agent = makeAgentStub({ workspaceDir: tmpRoot, claudeMd: '# Klavdia\nYou love jokes.' });
    const options = buildSdkOptions({ agent });
    expect(options.systemPrompt).toContain(CHAT_PERSONALITY_BASELINE);
    expect(options.systemPrompt).toContain('# Klavdia');
    expect(options.systemPrompt).toContain('You love jokes.');
    expect(options.systemPrompt).toContain('─────────');
  });

  it('systemPrompt uses personality override when set', () => {
    const agent = makeAgentStub({
      workspaceDir: tmpRoot,
      personality: 'You are super formal and brief.',
      claudeMd: '# Klavdia',
    });
    const options = buildSdkOptions({ agent });
    expect(options.systemPrompt).toContain('You are super formal and brief.');
    expect(options.systemPrompt).not.toContain(CHAT_PERSONALITY_BASELINE);
  });

  it('handles missing CLAUDE.md gracefully (uses baseline only)', () => {
    const agent = makeAgentStub({ workspaceDir: tmpRoot });
    const options = buildSdkOptions({ agent });
    expect(options.systemPrompt).toContain(CHAT_PERSONALITY_BASELINE);
  });

  it('settingSources is empty array', () => {
    const agent = makeAgentStub({ workspaceDir: tmpRoot, claudeMd: '# test' });
    const options = buildSdkOptions({ agent });
    expect(options.settingSources).toEqual([]);
  });

  it('disallowedTools still includes harness blocklist', () => {
    const agent = makeAgentStub({ workspaceDir: tmpRoot, claudeMd: '# test' });
    const options = buildSdkOptions({ agent });
    expect(options.disallowedTools).toContain('CronCreate');
    expect(options.disallowedTools).toContain('RemoteTrigger');
  });

  it('keeps manage_cron in allowedTools when registered on the MCP server', () => {
    const agent = makeAgentStub({
      workspaceDir: tmpRoot,
      claudeMd: '# test',
      tools: [{
        name: 'manage_cron',
        description: 'Manage cron',
        inputSchema: {},
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      }],
    });
    const options = buildSdkOptions({ agent });
    expect(options.allowedTools).toContain('mcp__test-tools__manage_cron');
    expect(options.disallowedTools).toContain('CronCreate');
    expect(options.disallowedTools).toContain('RemoteTrigger');
  });

  // Plan task #32 — backward-compat byte-equality with v0.8.0.
  // For chat_like_openclaw + plain-text CLAUDE.md (no @-imports),
  // the new composeSystemPrompt path must produce exactly the same string
  // the old inlined resolveChatSystemPrompt did. Any drift here would mean
  // existing chat agents see a different system prompt.
  it('chat_like_openclaw + plain CLAUDE.md (no @-imports) is byte-identical to v0.8.0 output', () => {
    const claudeMd = '# Test\n\nplain content';
    const agent = makeAgentStub({ workspaceDir: tmpRoot, claudeMd });
    const options = buildSdkOptions({ agent });
    const expected = `${CHAT_PERSONALITY_BASELINE}\n\n─────────\n\n# Test\n\nplain content`;
    expect(options.systemPrompt).toBe(expected);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CLAUDE_AI_KNOWN_SERVERS,
  buildClaudeAiDenyRules,
  buildClaudeAiDeniedMcpServers,
  isClaudeAiMcpToolName,
} from '../claude-ai-blocklist.js';

describe('claude-ai-blocklist', () => {
  it('CLAUDE_AI_KNOWN_SERVERS covers the integrations observed in prod (2026-05-14)', () => {
    // Spot-check the high-profile ones the hallucination bug surfaced on.
    expect(CLAUDE_AI_KNOWN_SERVERS).toContain('Gmail');
    expect(CLAUDE_AI_KNOWN_SERVERS).toContain('Linear');
    expect(CLAUDE_AI_KNOWN_SERVERS).toContain('Notion');
    expect(CLAUDE_AI_KNOWN_SERVERS).toContain('Google_Calendar');
    // Both case variants of Composio observed in transcripts.
    expect(CLAUDE_AI_KNOWN_SERVERS).toContain('Composio');
    expect(CLAUDE_AI_KNOWN_SERVERS).toContain('composio');
  });

  it('buildClaudeAiDenyRules emits the wildcard rule + one per known server', () => {
    const rules = buildClaudeAiDenyRules();
    expect(rules[0]).toBe('mcp__claude_ai_*');
    expect(rules.length).toBe(CLAUDE_AI_KNOWN_SERVERS.length + 1);
    expect(rules).toContain('mcp__claude_ai_Gmail');
    expect(rules).toContain('mcp__claude_ai_Linear');
  });

  it('buildClaudeAiDeniedMcpServers emits one entry per known server with claude_ai_ prefix', () => {
    const entries = buildClaudeAiDeniedMcpServers();
    expect(entries.length).toBe(CLAUDE_AI_KNOWN_SERVERS.length);
    const names = entries.map((e) => e.serverName);
    expect(names).toContain('claude_ai_Gmail');
    expect(names).toContain('claude_ai_Linear');
    expect(names).toContain('claude_ai_Notion');
  });

  it('isClaudeAiMcpToolName matches the OAuth-injected namespace only', () => {
    expect(isClaudeAiMcpToolName('mcp__claude_ai_Gmail__search_threads')).toBe(true);
    expect(isClaudeAiMcpToolName('mcp__claude_ai_Notion__search')).toBe(true);
    // Agent's own MCP server tools.
    expect(isClaudeAiMcpToolName('mcp__agent1-tools__memory_search')).toBe(false);
    // External MCP server declared by the agent.
    expect(isClaudeAiMcpToolName('mcp__sentry__get_issue')).toBe(false);
    // Built-in tools.
    expect(isClaudeAiMcpToolName('Bash')).toBe(false);
    expect(isClaudeAiMcpToolName('')).toBe(false);
  });
});

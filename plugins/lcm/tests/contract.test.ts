/**
 * Contract test — LCM plugin must never import the Anthropic SDK directly.
 *
 * The native-runtime constraint (project-wide): LLM calls go through
 * `query()` from `@anthropic-ai/claude-agent-sdk` exclusively. Plugins are
 * one level further removed — they get their LLM channel via
 * `ctx.runSubagent()`. The plugin must NEVER import either SDK directly.
 *
 * Bypassing this risks subscription bans (see CLAUDE.md / handoff docs).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_RUNTIME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

function* walkTsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkTsFiles(full);
    } else if (entry.endsWith('.ts')) {
      yield full;
    }
  }
}

describe('LCM plugin contract', () => {
  it('does not import @anthropic-ai/sdk directly', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(PLUGIN_RUNTIME_DIR)) {
      const src = readFileSync(file, 'utf-8');
      if (
        /from\s+['"]@anthropic-ai\/sdk['"]/.test(src) ||
        /require\s*\(\s*['"]@anthropic-ai\/sdk['"]\s*\)/.test(src)
      ) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `LCM plugin must NOT import @anthropic-ai/sdk — found:\n${offenders.join('\n')}`,
    ).toHaveLength(0);
  });

  it('does not call messages.create (Messages API tool loop forbidden)', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(PLUGIN_RUNTIME_DIR)) {
      const src = readFileSync(file, 'utf-8');
      if (/messages\.create\s*\(/.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `LCM plugin must NOT call messages.create — found:\n${offenders.join('\n')}`,
    ).toHaveLength(0);
  });

  it('does not import @anthropic-ai/claude-agent-sdk anywhere (uses ctx.runSubagent only)', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(PLUGIN_RUNTIME_DIR)) {
      const src = readFileSync(file, 'utf-8');
      if (/from\s+['"]@anthropic-ai\/claude-agent-sdk['"]/.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `LCM plugin must use ctx.runSubagent — direct SDK import found:\n${offenders.join('\n')}`,
    ).toHaveLength(0);
  });
});

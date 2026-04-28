import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_RUNTIME_DIR = resolve(__dirname, '..'); // src/plugins/

function* walkTsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTsFiles(full);
    else if (entry.endsWith('.ts')) yield full;
  }
}

describe('plugin-framework contract', () => {
  it('does not import @anthropic-ai/sdk directly', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(PLUGINS_RUNTIME_DIR)) {
      const src = readFileSync(file, 'utf-8');
      if (
        /from\s+['"]@anthropic-ai\/sdk['"]/.test(src) ||
        /require\s*\(\s*['"]@anthropic-ai\/sdk['"]\s*\)/.test(src)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders, `Files with forbidden import:\n${offenders.join('\n')}`).toHaveLength(0);
  });

  it('does not call Messages API directly (messages.create)', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(PLUGINS_RUNTIME_DIR)) {
      const src = readFileSync(file, 'utf-8');
      if (/messages\.create\s*\(/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders, `Files using Messages API:\n${offenders.join('\n')}`).toHaveLength(0);
  });

  it('runSubagent is the only place that imports @anthropic-ai/claude-agent-sdk', () => {
    const importers: string[] = [];
    for (const file of walkTsFiles(PLUGINS_RUNTIME_DIR)) {
      const src = readFileSync(file, 'utf-8');
      if (/from\s+['"]@anthropic-ai\/claude-agent-sdk['"]/.test(src)) {
        importers.push(file);
      }
    }
    // Allowed: subagent-runner.ts (uses query). Types-only files allowed too if any.
    const allowed = importers.filter(f =>
      f.endsWith('subagent-runner.ts') || f.endsWith('types.ts')
    );
    const disallowed = importers.filter(f => !allowed.includes(f));
    expect(disallowed, `Disallowed importers:\n${disallowed.join('\n')}`).toHaveLength(0);
  });
});

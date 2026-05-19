import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const directClaudeSdkImport = '@anthropic-ai/claude-agent-sdk';

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function walkTsFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(resolve(repoRoot, dir))) {
    const relative = `${dir}/${entry}`;
    const absolute = resolve(repoRoot, relative);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      if (entry === 'dist' || entry === 'node_modules') continue;
      walkTsFiles(relative, files);
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) files.push(relative);
  }
  return files;
}

describe('runtime import boundary', () => {
  it('keeps Gateway/headless/warm paths off direct Claude Agent SDK runtime imports', () => {
    const files = [
      'src/gateway.ts',
      'src/sdk/headless-review.ts',
      'src/plugins/subagent-runner.ts',
      'src/learning/runner.ts',
      'src/session/title-generator.ts',
      'src/sdk/warm-pool.ts',
      'src/sdk/control-registry.ts',
      'src/sdk/checkpoints.ts',
      'src/routing/queue-manager.ts',
      'src/runtime/headless.ts',
      'src/runtime/headless-registry.ts',
      'src/runtime/pi-headless.ts',
      'src/runtime/opencode-headless.ts',
    ];

    for (const file of files) {
      expect(readRepoFile(file), `${file} should use the legacy Claude adapter boundary`).not.toContain(
        directClaudeSdkImport,
      );
    }
  });

  it('keeps direct Claude Agent SDK runtime imports inside the legacy compatibility package', () => {
    expect(readRepoFile('src/runtime/claude-agent-sdk.ts')).toContain('@anthroclaw/legacy-claude-agent-sdk');
    expect(readRepoFile('src/runtime/claude-agent-sdk.ts')).not.toContain(directClaudeSdkImport);
    expect(readRepoFile('packages/legacy-claude-agent-sdk/src/index.ts')).toContain(directClaudeSdkImport);
  });

  it('keeps all root src code off direct Claude Agent SDK imports', () => {
    const offenders = walkTsFiles('src')
      .filter((file) => !file.startsWith('src/runtime/__tests__/'))
      .filter((file) => readRepoFile(file).includes(directClaudeSdkImport));

    expect(offenders, `Direct Claude Agent SDK importers:\n${offenders.join('\n')}`).toHaveLength(0);
  });
});

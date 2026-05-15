import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('runtime import boundary', () => {
  it('keeps Gateway/headless/warm paths off direct Claude Agent SDK runtime imports', () => {
    const files = [
      'src/gateway.ts',
      'src/sdk/headless-review.ts',
      'src/sdk/warm-pool.ts',
      'src/sdk/control-registry.ts',
      'src/sdk/checkpoints.ts',
      'src/routing/queue-manager.ts',
    ];

    for (const file of files) {
      expect(readRepoFile(file), `${file} should use src/runtime/claude-agent-sdk.ts`).not.toContain(
        '@anthropic-ai/claude-agent-sdk',
      );
    }
  });

  it('keeps the direct Claude Agent SDK dependency centralized in the Claude adapter for this seam', () => {
    expect(readRepoFile('src/runtime/claude-agent-sdk.ts')).toContain('@anthropic-ai/claude-agent-sdk');
  });
});

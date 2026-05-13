import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('buildroom CLI entrypoint', () => {
  it('exposes a package script for local operator use', () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.buildroom).toBe('tsx src/cli/buildroom.ts');
  });
});

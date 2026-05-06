import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { installLocalPlugin } from './local.js';
import type { PluginInstallRecord } from '../install-store.js';

const execFileAsync = promisify(execFile);

export async function installNpmPlugin(input: {
  spec: string;
  dataDir: string;
  now?: number;
}): Promise<PluginInstallRecord> {
  const tmp = mkdtempSync(join(tmpdir(), 'anthroclaw-plugin-npm-'));
  try {
    const { stdout } = await execFileAsync('npm', ['pack', input.spec, '--pack-destination', tmp]);
    const tarball = stdout.trim().split('\n').at(-1);
    if (!tarball) throw new Error(`npm pack produced no tarball for ${input.spec}`);
    await execFileAsync('tar', ['-xzf', join(tmp, tarball), '-C', tmp]);
    const sourcePath = join(tmp, 'package');
    return await installLocalPlugin({
      sourcePath,
      dataDir: input.dataDir,
      sourceType: 'npm',
      sourceSpec: input.spec,
      now: input.now,
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function findPackedTarball(tmp: string): string | null {
  return readdirSync(tmp).find((entry) => entry.endsWith('.tgz')) ?? null;
}

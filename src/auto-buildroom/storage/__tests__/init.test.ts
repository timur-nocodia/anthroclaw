import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeBuildroomStorage } from '../init.js';

describe('Auto-Buildroom storage init', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-init-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates project-local Buildroom config and room directories', () => {
    const result = initializeBuildroomStorage({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      operatorId: 'cli:user:local-operator',
    });

    expect(result.created).toContain(join(root, '.anthroclaw', 'auto-buildroom'));
    expect(result.configPath).toBe(join(root, '.anthroclaw', 'auto-buildroom', 'buildroom.yml'));
    expect(result.roomConfigPath).toBe(
      join(root, '.anthroclaw', 'auto-buildroom', 'rooms', 'anthroclaw-core', 'buildroom.yml'),
    );

    const rootConfig = parseYaml(readFileSync(result.configPath, 'utf8')) as Record<string, unknown>;
    expect(rootConfig).toMatchObject({
      schemaVersion: 'auto-buildroom/v1',
      defaultRoom: 'anthroclaw-core',
    });

    const roomConfig = parseYaml(readFileSync(result.roomConfigPath, 'utf8')) as Record<string, unknown>;
    expect(roomConfig).toMatchObject({
      schemaVersion: 'auto-buildroom/v1',
      roomId: 'anthroclaw-core',
      mode: 'manual_approval',
      killSwitchActive: false,
    });

    for (const rel of [
      'locks',
      'rooms/anthroclaw-core/buildroom/research',
      'rooms/anthroclaw-core/buildroom/ideas',
      'rooms/anthroclaw-core/buildroom/approvals',
      'rooms/anthroclaw-core/buildroom/plans',
      'rooms/anthroclaw-core/buildroom/builds',
      'rooms/anthroclaw-core/buildroom/qa',
      'rooms/anthroclaw-core/buildroom/deltas',
      'rooms/anthroclaw-core/buildroom/trust',
      'rooms/anthroclaw-core/buildroom/operator/reports',
      'rooms/anthroclaw-core/runtime/events',
      'rooms/anthroclaw-core/worktrees',
    ]) {
      expect(result.created).toContain(join(root, '.anthroclaw', 'auto-buildroom', rel));
    }
  });

  it('does not overwrite existing config without explicit overwrite', () => {
    const first = initializeBuildroomStorage({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      operatorId: 'cli:user:local-operator',
    });
    mkdirSync(join(root, '.anthroclaw'), { recursive: true });

    expect(() =>
      initializeBuildroomStorage({
        projectRoot: root,
        roomId: 'anthroclaw-core',
        operatorId: 'cli:user:local-operator',
      }),
    ).toThrow(/already exists/);

    expect(readFileSync(first.configPath, 'utf8')).toContain('anthroclaw-core');
  });

  it('does not create storage when default room config is invalid', () => {
    expect(() =>
      initializeBuildroomStorage({
        projectRoot: root,
        roomId: 'anthroclaw-core',
        operatorId: 'telegram_chat:-1001234567890',
      }),
    ).toThrow(/Telegram chat\/thread route is not operator identity/);

    expect(existsSync(join(root, '.anthroclaw', 'auto-buildroom'))).toBe(false);
  });
});

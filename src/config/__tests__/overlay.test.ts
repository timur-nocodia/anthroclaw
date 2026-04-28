import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deepDiffOverlay,
  deepMergeOverlay,
  getOverlayPath,
  loadGlobalConfigWithOverlay,
  readBaseConfigRaw,
  readRuntimeOverlay,
  RUNTIME_OVERLAY_FILENAME,
  writeRuntimeOverlay,
} from '../overlay.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oc-overlay-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('deepMergeOverlay', () => {
  it('returns base when overlay is empty', () => {
    expect(deepMergeOverlay({ a: 1, b: { c: 2 } }, {})).toEqual({ a: 1, b: { c: 2 } });
  });

  it('overlay primitives win over base', () => {
    expect(deepMergeOverlay({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it('null in overlay deletes the key from base', () => {
    expect(deepMergeOverlay({ a: 1, b: 2 }, { a: null })).toEqual({ b: 2 });
  });

  it('null deletes nested keys', () => {
    const base = { whatsapp: { accounts: { foo: { auth_dir: '/x' }, bar: { auth_dir: '/y' } } } };
    const overlay = { whatsapp: { accounts: { foo: null } } };
    expect(deepMergeOverlay(base, overlay)).toEqual({
      whatsapp: { accounts: { bar: { auth_dir: '/y' } } },
    });
  });

  it('overlay adds new nested keys', () => {
    const base = { whatsapp: { accounts: { foo: { auth_dir: '/x' } } } };
    const overlay = { whatsapp: { accounts: { bar: { auth_dir: '/y' } } } };
    expect(deepMergeOverlay(base, overlay)).toEqual({
      whatsapp: { accounts: { foo: { auth_dir: '/x' }, bar: { auth_dir: '/y' } } },
    });
  });

  it('overlay arrays replace base arrays', () => {
    expect(deepMergeOverlay({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] });
  });

  it('does not mutate base', () => {
    const base = { whatsapp: { accounts: { foo: { auth_dir: '/x' } } } };
    const snapshot = JSON.parse(JSON.stringify(base));
    deepMergeOverlay(base, { whatsapp: { accounts: { foo: null } } });
    expect(base).toEqual(snapshot);
  });
});

describe('readRuntimeOverlay / writeRuntimeOverlay', () => {
  it('returns empty object when overlay file does not exist', () => {
    expect(readRuntimeOverlay(join(dir, 'missing.yml'))).toEqual({});
  });

  it('round-trips object through write/read', () => {
    const path = join(dir, 'overlay.yml');
    writeRuntimeOverlay(path, { whatsapp: { accounts: { foo: null } } });
    expect(existsSync(path)).toBe(true);
    expect(readRuntimeOverlay(path)).toEqual({ whatsapp: { accounts: { foo: null } } });
  });

  it('write creates parent directory if missing', () => {
    const path = join(dir, 'sub', 'nested', 'overlay.yml');
    writeRuntimeOverlay(path, { defaults: { debounce_ms: 1000 } });
    expect(existsSync(path)).toBe(true);
  });

  it('reading malformed yaml returns empty object and does not throw', () => {
    const path = join(dir, 'broken.yml');
    writeFileSync(path, ':\n  - not: [valid', 'utf-8');
    expect(readRuntimeOverlay(path)).toEqual({});
  });
});

describe('loadGlobalConfigWithOverlay', () => {
  it('loads base when overlay missing', () => {
    const basePath = join(dir, 'config.yml');
    writeFileSync(basePath, 'defaults:\n  debounce_ms: 3000\n', 'utf-8');
    const cfg = loadGlobalConfigWithOverlay(basePath, join(dir, 'overlay.yml'));
    expect(cfg.defaults.debounce_ms).toBe(3000);
  });

  it('overlay overrides base scalar', () => {
    const basePath = join(dir, 'config.yml');
    const overlayPath = join(dir, 'overlay.yml');
    writeFileSync(basePath, 'defaults:\n  debounce_ms: 3000\n', 'utf-8');
    writeFileSync(overlayPath, 'defaults:\n  debounce_ms: 7777\n', 'utf-8');
    const cfg = loadGlobalConfigWithOverlay(basePath, overlayPath);
    expect(cfg.defaults.debounce_ms).toBe(7777);
  });

  it('overlay deletes whatsapp account via null', () => {
    const basePath = join(dir, 'config.yml');
    const overlayPath = join(dir, 'overlay.yml');
    writeFileSync(
      basePath,
      'whatsapp:\n  accounts:\n    main:\n      auth_dir: ./data/whatsapp-auth/main\n    second:\n      auth_dir: ./data/whatsapp-auth/second\n',
      'utf-8',
    );
    writeFileSync(overlayPath, 'whatsapp:\n  accounts:\n    main: null\n', 'utf-8');
    const cfg = loadGlobalConfigWithOverlay(basePath, overlayPath);
    expect(cfg.whatsapp?.accounts).toEqual({ second: { auth_dir: './data/whatsapp-auth/second' } });
  });

  it('overlay adds new whatsapp account', () => {
    const basePath = join(dir, 'config.yml');
    const overlayPath = join(dir, 'overlay.yml');
    writeFileSync(basePath, 'defaults:\n  model: claude-sonnet-4-6\n', 'utf-8');
    writeFileSync(
      overlayPath,
      'whatsapp:\n  accounts:\n    new_acc:\n      auth_dir: ./data/whatsapp-auth/new_acc\n',
      'utf-8',
    );
    const cfg = loadGlobalConfigWithOverlay(basePath, overlayPath);
    expect(cfg.whatsapp?.accounts.new_acc).toEqual({ auth_dir: './data/whatsapp-auth/new_acc' });
  });

  it('throws when merged result fails schema validation', () => {
    const basePath = join(dir, 'config.yml');
    const overlayPath = join(dir, 'overlay.yml');
    writeFileSync(
      basePath,
      'whatsapp:\n  accounts:\n    main:\n      auth_dir: ./data/whatsapp-auth/main\n',
      'utf-8',
    );
    // Overlay leaves an account without required auth_dir field.
    writeFileSync(overlayPath, 'whatsapp:\n  accounts:\n    bad: {}\n', 'utf-8');
    expect(() => loadGlobalConfigWithOverlay(basePath, overlayPath)).toThrow();
  });

  it('substitutes env vars in base before merging', () => {
    process.env.OC_TEST_DEBOUNCE = '4321';
    const basePath = join(dir, 'config.yml');
    writeFileSync(basePath, 'defaults:\n  debounce_ms: ${OC_TEST_DEBOUNCE}\n', 'utf-8');
    const cfg = loadGlobalConfigWithOverlay(basePath, join(dir, 'overlay.yml'));
    expect(cfg.defaults.debounce_ms).toBe(4321);
    delete process.env.OC_TEST_DEBOUNCE;
  });
});

describe('deepDiffOverlay', () => {
  it('returns empty object when target equals base', () => {
    expect(deepDiffOverlay({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual({});
  });

  it('captures changed scalar', () => {
    expect(deepDiffOverlay({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it('captures added key', () => {
    expect(deepDiffOverlay({ a: 1 }, { a: 1, b: 2 })).toEqual({ b: 2 });
  });

  it('captures removed key as null tombstone', () => {
    expect(deepDiffOverlay({ a: 1, b: 2 }, { a: 1 })).toEqual({ b: null });
  });

  it('only captures differing subtree of nested object', () => {
    const base = { whatsapp: { accounts: { foo: { auth_dir: '/x' }, bar: { auth_dir: '/y' } } } };
    const target = { whatsapp: { accounts: { foo: { auth_dir: '/x' }, bar: { auth_dir: '/z' } } } };
    expect(deepDiffOverlay(base, target)).toEqual({
      whatsapp: { accounts: { bar: { auth_dir: '/z' } } },
    });
  });

  it('captures account deletion as nested null tombstone', () => {
    const base = { whatsapp: { accounts: { foo: { auth_dir: '/x' }, bar: { auth_dir: '/y' } } } };
    const target = { whatsapp: { accounts: { bar: { auth_dir: '/y' } } } };
    expect(deepDiffOverlay(base, target)).toEqual({
      whatsapp: { accounts: { foo: null } },
    });
  });

  it('round-trips through deepMergeOverlay', () => {
    const base = {
      whatsapp: { accounts: { keep: { auth_dir: '/k' }, drop: { auth_dir: '/d' } } },
      defaults: { debounce_ms: 1000 },
    };
    const target = {
      whatsapp: { accounts: { keep: { auth_dir: '/k' }, added: { auth_dir: '/a' } } },
      defaults: { debounce_ms: 5000 },
    };
    const overlay = deepDiffOverlay(base, target);
    expect(deepMergeOverlay(base, overlay)).toEqual(target);
  });
});

describe('getOverlayPath', () => {
  it('returns runtime-overrides.yml inside the data dir', () => {
    expect(getOverlayPath('/var/lib/anthroclaw/data')).toBe(
      `/var/lib/anthroclaw/data/${RUNTIME_OVERLAY_FILENAME}`,
    );
  });
});

describe('readBaseConfigRaw', () => {
  it('returns {} when file missing', () => {
    expect(readBaseConfigRaw(join(dir, 'absent.yml'))).toEqual({});
  });

  it('returns {} on malformed yaml', () => {
    const path = join(dir, 'bad.yml');
    writeFileSync(path, ':\n  - not: [valid', 'utf-8');
    expect(readBaseConfigRaw(path)).toEqual({});
  });

  it('parses valid yaml without env substitution', () => {
    const path = join(dir, 'config.yml');
    writeFileSync(path, 'whatsapp:\n  accounts:\n    main:\n      auth_dir: ${SHOULD_NOT_RESOLVE}\n', 'utf-8');
    const parsed = readBaseConfigRaw(path) as { whatsapp: { accounts: { main: { auth_dir: string } } } };
    expect(parsed.whatsapp.accounts.main.auth_dir).toBe('${SHOULD_NOT_RESOLVE}');
  });
});

describe('writeRuntimeOverlay edge cases', () => {
  it('round-trips through readRuntimeOverlay even after rewrite', () => {
    const path = join(dir, 'overlay.yml');
    writeRuntimeOverlay(path, { defaults: { debounce_ms: 1000 } });
    writeRuntimeOverlay(path, { defaults: { debounce_ms: 2000 } });
    expect(readRuntimeOverlay(path)).toEqual({ defaults: { debounce_ms: 2000 } });
  });

  it('writes parseable yaml on disk', () => {
    const path = join(dir, 'overlay.yml');
    writeRuntimeOverlay(path, { whatsapp: { accounts: { foo: null } } });
    const raw = readFileSync(path, 'utf-8');
    expect(raw).toContain('whatsapp:');
    expect(raw).toContain('foo: null');
  });
});

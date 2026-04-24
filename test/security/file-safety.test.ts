import { describe, it, expect, afterEach } from 'vitest';
import { isWriteDenied, isReadDenied } from '../../src/security/file-safety.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();

// ---------------------------------------------------------------------------
// Write denylist — exact home-relative files
// ---------------------------------------------------------------------------

describe('isWriteDenied – exact home-relative', () => {
  const denied = [
    '.ssh/authorized_keys',
    '.ssh/id_rsa',
    '.ssh/id_ed25519',
    '.ssh/config',
    '.bashrc',
    '.zshrc',
    '.profile',
    '.bash_profile',
    '.netrc',
    '.npmrc',
    '.pgpass',
    '.pypirc',
  ];

  for (const file of denied) {
    it(`denies ${file}`, () => {
      expect(isWriteDenied(join(HOME, file))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Write denylist — absolute exact
// ---------------------------------------------------------------------------

describe('isWriteDenied – absolute exact', () => {
  it('denies /etc/sudoers', () => {
    expect(isWriteDenied('/etc/sudoers')).toBe(true);
  });
  it('denies /etc/passwd', () => {
    expect(isWriteDenied('/etc/passwd')).toBe(true);
  });
  it('denies /etc/shadow', () => {
    expect(isWriteDenied('/etc/shadow')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Write denylist — prefix home-relative
// ---------------------------------------------------------------------------

describe('isWriteDenied – prefix home-relative', () => {
  const prefixes = [
    ['.ssh/', '.ssh/known_hosts'],
    ['.aws/', '.aws/credentials'],
    ['.gnupg/', '.gnupg/pubring.kbx'],
    ['.kube/', '.kube/config'],
    ['.docker/', '.docker/config.json'],
    ['.azure/', '.azure/accessTokens.json'],
    ['.config/gh/', '.config/gh/hosts.yml'],
  ] as const;

  for (const [prefix, example] of prefixes) {
    it(`denies files under ~/${prefix} (e.g. ${example})`, () => {
      expect(isWriteDenied(join(HOME, example))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Write denylist — absolute prefix
// ---------------------------------------------------------------------------

describe('isWriteDenied – absolute prefix', () => {
  it('denies /etc/sudoers.d/custom', () => {
    expect(isWriteDenied('/etc/sudoers.d/custom')).toBe(true);
  });
  it('denies /etc/systemd/system/my.service', () => {
    expect(isWriteDenied('/etc/systemd/system/my.service')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Write denylist — allowed paths
// ---------------------------------------------------------------------------

describe('isWriteDenied – allowed paths', () => {
  it('allows regular project files', () => {
    expect(isWriteDenied('/tmp/test.txt')).toBe(false);
  });
  it('allows files in home that are not denied', () => {
    expect(isWriteDenied(join(HOME, 'projects/app/src/index.ts'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Read denylist — includes .env files
// ---------------------------------------------------------------------------

describe('isReadDenied – .env files', () => {
  it('denies .env', () => {
    expect(isReadDenied('/app/.env')).toBe(true);
  });
  it('denies .env.local', () => {
    expect(isReadDenied('/app/.env.local')).toBe(true);
  });
  it('denies .env.production', () => {
    expect(isReadDenied('/app/.env.production')).toBe(true);
  });
  it('allows env.ts (not a dotfile)', () => {
    expect(isReadDenied('/app/env.ts')).toBe(false);
  });
});

describe('isReadDenied – inherits write denylist', () => {
  it('denies .ssh/id_rsa for reading', () => {
    expect(isReadDenied(join(HOME, '.ssh/id_rsa'))).toBe(true);
  });
  it('denies /etc/shadow for reading', () => {
    expect(isReadDenied('/etc/shadow')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isWriteDenied — .env NOT blocked for write
// ---------------------------------------------------------------------------

describe('isWriteDenied – .env files not blocked for write', () => {
  it('allows writing .env', () => {
    expect(isWriteDenied('/app/.env')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WRITE_SAFE_ROOT enforcement
// ---------------------------------------------------------------------------

describe('isWriteDenied – WRITE_SAFE_ROOT', () => {
  afterEach(() => {
    delete process.env.WRITE_SAFE_ROOT;
  });

  it('denies writes outside WRITE_SAFE_ROOT', () => {
    process.env.WRITE_SAFE_ROOT = '/allowed/dir';
    expect(isWriteDenied('/other/place/file.txt')).toBe(true);
  });

  it('allows writes inside WRITE_SAFE_ROOT', () => {
    process.env.WRITE_SAFE_ROOT = '/allowed/dir';
    expect(isWriteDenied('/allowed/dir/file.txt')).toBe(false);
  });

  it('allows writes at WRITE_SAFE_ROOT root itself', () => {
    process.env.WRITE_SAFE_ROOT = '/allowed/dir';
    // The root itself is the directory, writing a file at root is "inside"
    expect(isWriteDenied('/allowed/dir')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Path traversal
// ---------------------------------------------------------------------------

describe('isWriteDenied – path traversal', () => {
  it('resolves .. before checking', () => {
    // /home/user/projects/../.ssh/id_rsa → /home/user/.ssh/id_rsa
    expect(isWriteDenied(join(HOME, 'projects', '..', '.ssh', 'id_rsa'))).toBe(true);
  });
});

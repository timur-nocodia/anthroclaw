import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { stringify as stringifyYaml } from 'yaml';
import { execSync } from 'node:child_process';

let TEMP_DIR: string;
let skillsModule: typeof import('@/lib/skills');
let agentsModule: typeof import('@/lib/agents');

beforeEach(async () => {
  TEMP_DIR = join(tmpdir(), `skills-test-${randomUUID()}`);
  mkdirSync(TEMP_DIR, { recursive: true });

  vi.spyOn(process, 'cwd').mockReturnValue(join(TEMP_DIR, 'ui'));
  mkdirSync(join(TEMP_DIR, 'ui'), { recursive: true });
  mkdirSync(join(TEMP_DIR, 'agents'), { recursive: true });

  vi.resetModules();
  skillsModule = await import('@/lib/skills');
  agentsModule = await import('@/lib/agents');
});

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  }
});

function agentsDir() {
  return join(TEMP_DIR, 'agents');
}

function createTestAgent(id: string): string {
  const dir = join(agentsDir(), id);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'memory'), { recursive: true });
  mkdirSync(join(dir, '.claude', 'skills'), { recursive: true });

  writeFileSync(
    join(dir, 'agent.yml'),
    stringifyYaml({ model: 'claude-sonnet-4-6', routes: [{ channel: 'telegram', scope: 'dm' }] }),
    'utf-8',
  );
  writeFileSync(join(dir, 'CLAUDE.md'), `# ${id}\n`, 'utf-8');
  return dir;
}

function createCatalogSkill(skillName: string, content?: string): string {
  const dir = join(TEMP_DIR, 'data', 'skill-catalog', skillName);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, 'SKILL.md'),
    content ??
      `---
name: ${skillName}
version: "1.0"
---
# ${skillName}

This is a test skill for ${skillName}.

## Usage
Use it wisely.
`,
    'utf-8',
  );

  return dir;
}

function createAttachedSkill(agentId: string, skillName: string, content?: string): string {
  const dir = join(agentsDir(), agentId, '.claude', 'skills', skillName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content ?? `# ${skillName}\n\nAttached only.\n`, 'utf-8');
  return dir;
}

describe('listSkills', () => {
  it('returns empty array when no skills', () => {
    createTestAgent('no-skills');
    const skills = skillsModule.listSkills('no-skills');
    expect(skills).toEqual([]);
  });

  it('returns multiple skills', () => {
    createTestAgent('multi-skill');
    createCatalogSkill('skill-a');
    createCatalogSkill('skill-b');

    const skills = skillsModule.listSkills('multi-skill');
    expect(skills).toHaveLength(2);

    const names = skills.map((s) => s.name);
    expect(names).toContain('skill-a');
    expect(names).toContain('skill-b');

    // All should have SKILL.md
    for (const skill of skills) {
      expect(skill.hasSkillMd).toBe(true);
      expect(skill.catalog).toBe(true);
      expect(skill.attached).toBe(false);
    }
  });

  it('extracts description from SKILL.md', () => {
    createTestAgent('desc-test');
    createCatalogSkill('my-skill', `# My Skill\n\nThis is the description line.\n`);

    const skills = skillsModule.listSkills('desc-test');
    expect(skills[0].description).toBe('This is the description line.');
  });

  it('marks catalog skills as attached when materialized in .claude/skills', () => {
    createTestAgent('attached-test');
    createCatalogSkill('my-skill');
    createAttachedSkill('attached-test', 'my-skill');

    const skills = skillsModule.listSkills('attached-test');
    expect(skills[0]).toMatchObject({ name: 'my-skill', catalog: true, attached: true });
  });

  it('includes attached local-only skills not yet in catalog', () => {
    createTestAgent('local-only-test');
    createAttachedSkill('local-only-test', 'local-skill');

    const skills = skillsModule.listSkills('local-only-test');
    expect(skills[0]).toMatchObject({ name: 'local-skill', catalog: false, attached: true });
  });
});

describe('getSkill', () => {
  it('returns content and frontmatter', () => {
    createTestAgent('get-skill');
    createCatalogSkill('test-skill');

    const skill = skillsModule.getSkill('get-skill', 'test-skill');
    expect(skill.name).toBe('test-skill');
    expect(skill.content).toContain('test skill');
    expect(skill.frontmatter.name).toBe('test-skill');
    expect(skill.frontmatter.version).toBe('1.0');
    expect(skill.catalog).toBe(true);
  });

  it('throws NotFoundError for missing skill', () => {
    createTestAgent('no-skill');
    expect(() => skillsModule.getSkill('no-skill', 'nope')).toThrow(agentsModule.NotFoundError);
  });
});

describe('deleteSkill', () => {
  it('detaches skill directory from agent without deleting catalog copy', () => {
    createTestAgent('del-skill');
    createCatalogSkill('to-remove');
    const dir = createAttachedSkill('del-skill', 'to-remove');
    expect(existsSync(dir)).toBe(true);

    skillsModule.deleteSkill('del-skill', 'to-remove');
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(TEMP_DIR, 'data', 'skill-catalog', 'to-remove', 'SKILL.md'))).toBe(true);
  });

  it('throws NotFoundError for missing skill', () => {
    createTestAgent('del-missing');
    expect(() => skillsModule.deleteSkill('del-missing', 'nope')).toThrow(agentsModule.NotFoundError);
  });
});

describe('installSkillFromGit', () => {
  it('clones repo and validates SKILL.md', () => {
    createTestAgent('git-skill');

    // Create a local git repo to clone from
    const repoDir = join(TEMP_DIR, 'fake-repo');
    mkdirSync(repoDir, { recursive: true });
    execSync('git init', { cwd: repoDir });
    execSync('git config user.email "test@test.com"', { cwd: repoDir });
    execSync('git config user.name "Test"', { cwd: repoDir });
    writeFileSync(join(repoDir, 'SKILL.md'), '# Test Git Skill\n\nA test skill from git.\n', 'utf-8');
    execSync('git add . && git commit -m "init"', { cwd: repoDir });

    const name = skillsModule.installSkillFromGit('git-skill', repoDir, undefined, 'git-test');

    expect(name).toBe('git-test');
    expect(existsSync(join(TEMP_DIR, 'data', 'skill-catalog', 'git-test', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(agentsDir(), 'git-skill', '.claude', 'skills', 'git-test', 'SKILL.md'))).toBe(true);
  });

  it('throws when SKILL.md is missing', () => {
    createTestAgent('git-no-skill');

    const repoDir = join(TEMP_DIR, 'empty-repo');
    mkdirSync(repoDir, { recursive: true });
    execSync('git init', { cwd: repoDir });
    execSync('git config user.email "test@test.com"', { cwd: repoDir });
    execSync('git config user.name "Test"', { cwd: repoDir });
    writeFileSync(join(repoDir, 'README.md'), '# No skill here\n', 'utf-8');
    execSync('git add . && git commit -m "init"', { cwd: repoDir });

    expect(() =>
      skillsModule.installSkillFromGit('git-no-skill', repoDir),
    ).toThrow(agentsModule.ValidationError);
  });
});

describe('installSkillFromArchive', () => {
  it('installs from a tar.gz with valid SKILL.md', async () => {
    createTestAgent('archive-skill');

    // Create a tarball
    const srcDir = join(TEMP_DIR, 'tar-src', 'my-skill');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'SKILL.md'), '# Archive Skill\n\nFrom a tarball.\n', 'utf-8');
    writeFileSync(join(srcDir, 'helper.md'), 'extra file', 'utf-8');

    const tarPath = join(TEMP_DIR, 'test.tar.gz');
    execSync(`tar -czf "${tarPath}" -C "${join(TEMP_DIR, 'tar-src')}" my-skill`);

    const buffer = require('node:fs').readFileSync(tarPath) as Buffer;
    const name = await skillsModule.installSkillFromArchive('archive-skill', buffer, 'test.tar.gz');

    expect(name).toBe('my-skill');
    const skillDir = join(agentsDir(), 'archive-skill', '.claude', 'skills', 'my-skill');
    const catalogDir = join(TEMP_DIR, 'data', 'skill-catalog', 'my-skill');
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillDir, 'helper.md'))).toBe(true);
    expect(existsSync(join(catalogDir, 'SKILL.md'))).toBe(true);
  });

  it('installs from a zip with valid SKILL.md', async () => {
    createTestAgent('zip-skill');

    // Create a zip
    const srcDir = join(TEMP_DIR, 'zip-src', 'zip-test');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'SKILL.md'), '# Zip Skill\n\nFrom a zip.\n', 'utf-8');

    const zipPath = join(TEMP_DIR, 'test.zip');
    execSync(`cd "${join(TEMP_DIR, 'zip-src')}" && zip -r "${zipPath}" zip-test`);

    const buffer = require('node:fs').readFileSync(zipPath) as Buffer;
    const name = await skillsModule.installSkillFromArchive('zip-skill', buffer, 'test.zip');

    expect(name).toBe('zip-test');
    expect(
      existsSync(join(agentsDir(), 'zip-skill', '.claude', 'skills', 'zip-test', 'SKILL.md')),
    ).toBe(true);
    expect(existsSync(join(TEMP_DIR, 'data', 'skill-catalog', 'zip-test', 'SKILL.md'))).toBe(true);
  });

  it('rejects archive without SKILL.md', async () => {
    createTestAgent('no-skill-archive');

    const srcDir = join(TEMP_DIR, 'nosm-src', 'bad-skill');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'README.md'), 'not a skill', 'utf-8');

    const tarPath = join(TEMP_DIR, 'bad.tar.gz');
    execSync(`tar -czf "${tarPath}" -C "${join(TEMP_DIR, 'nosm-src')}" bad-skill`);

    const buffer = require('node:fs').readFileSync(tarPath) as Buffer;
    await expect(
      skillsModule.installSkillFromArchive('no-skill-archive', buffer, 'bad.tar.gz'),
    ).rejects.toThrow(agentsModule.ValidationError);
  });
});

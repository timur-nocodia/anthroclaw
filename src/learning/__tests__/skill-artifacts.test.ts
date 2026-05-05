import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandActiveSkillArtifactFiles } from '../skill-artifacts.js';

describe('expandActiveSkillArtifactFiles', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'learning-skill-artifacts-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('exports SKILL.md plus references and templates for active skills only', () => {
    seedSkill('publishing', {
      references: { 'checklist.md': '# Checklist\n' },
      templates: { 'brief.md': '# Brief\n' },
    });
    seedSkill('unused', {
      references: { 'unused.md': '# Unused\n' },
    });

    const files = expandActiveSkillArtifactFiles({
      workspacePath,
      activeSkills: ['publishing'],
    });

    expect(files.map((file) => file.path).sort()).toEqual([
      '.claude/skills/publishing/SKILL.md',
      '.claude/skills/publishing/references/checklist.md',
      '.claude/skills/publishing/templates/brief.md',
    ]);
    expect(files.map((file) => file.path)).not.toContain('.claude/skills/unused/SKILL.md');
  });

  it('ignores unsafe skill names and broad directory traversal', () => {
    seedSkill('safe-skill', {});

    const files = expandActiveSkillArtifactFiles({
      workspacePath,
      activeSkills: ['../escape', 'safe-skill'],
    });

    expect(files.map((file) => file.path)).toEqual(['.claude/skills/safe-skill/SKILL.md']);
  });

  function seedSkill(
    name: string,
    extras: { references?: Record<string, string>; templates?: Record<string, string> },
  ): void {
    const skillDir = join(workspacePath, '.claude', 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `# ${name}\n`, 'utf8');
    for (const [dirName, files] of Object.entries(extras)) {
      for (const [filename, body] of Object.entries(files ?? {})) {
        mkdirSync(join(skillDir, dirName), { recursive: true });
        writeFileSync(join(skillDir, dirName, filename), body, 'utf8');
      }
    }
  }
});

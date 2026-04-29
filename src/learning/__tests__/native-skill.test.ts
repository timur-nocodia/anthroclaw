import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateSkillDocument } from '../../security/skill-guard.js';
import { discoverWorkspaceSkills } from '../../skills/workspace.js';

describe('anthroclaw-learning native skill', () => {
  const repoRoot = process.cwd();
  const skillPath = join(repoRoot, '.claude', 'skills', 'anthroclaw-learning', 'SKILL.md');

  it('is a valid native skill document', () => {
    const content = readFileSync(skillPath, 'utf8');
    expect(() => validateSkillDocument(content)).not.toThrow();
  });

  it('is discoverable and covers required learning guidance', () => {
    const skills = discoverWorkspaceSkills({ workspacePath: repoRoot });
    expect(skills.find((skill) => skill.name === 'anthroclaw-learning')).toMatchObject({
      native: true,
      title: 'anthroclaw-learning',
      description: expect.stringContaining('durable memory'),
    });

    const content = readFileSync(skillPath, 'utf8');
    expect(content).toContain('Memory vs Skills');
    expect(content).toContain('Durable Corrections');
    expect(content).toContain('Reusable Workflows');
    expect(content).toContain('What Not To Store');
    expect(content).toContain('Skill Update Guidance');
    expect(content).toContain('.claude/skills/<skill-name>/SKILL.md');
  });
});

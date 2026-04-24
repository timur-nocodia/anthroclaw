import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createListSkillsTool } from '../../../src/agent/tools/list-skills.js';

describe('createListSkillsTool', () => {
  let tmpDir: string;

  function setup(skills: Record<string, string> = {}) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    const skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(skillsDir);

    for (const [name, content] of Object.entries(skills)) {
      const dir = path.join(skillsDir, name);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
    }

    return createListSkillsTool(tmpDir);
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('has correct name', () => {
    const tool = setup();
    expect(tool.name).toBe('list_skills');
  });

  it('lists all skills with titles', async () => {
    const tool = setup({
      'twitter-posting': '# Twitter Posting V3\nCreate viral tweets.',
      'exa': '# Exa Search\nNeural web search.',
    });
    const res = await tool.handler({});
    expect(res.content[0].text).toContain('twitter-posting');
    expect(res.content[0].text).toContain('Twitter Posting V3');
    expect(res.content[0].text).toContain('exa');
    expect(res.content[0].text).toContain('Exa Search');
    expect(res.content[0].text).toContain('Available skills (2)');
  });

  it('reads specific skill SKILL.md', async () => {
    const tool = setup({
      'my-skill': '# My Skill\n\nFull content here.\n\n## Workflow\n1. Step one',
    });
    const res = await tool.handler({ skill_name: 'my-skill' });
    expect(res.content[0].text).toContain('Full content here');
    expect(res.content[0].text).toContain('## Workflow');
  });

  it('returns error for missing skill', async () => {
    const tool = setup({});
    const res = await tool.handler({ skill_name: 'nonexistent' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not found');
  });

  it('handles no skills directory', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    const tool = createListSkillsTool(tmpDir);
    return tool.handler({}).then((res) => {
      expect(res.content[0].text).toContain('No skills found');
    });
  });

  it('handles empty skills directory', async () => {
    const tool = setup({});
    const res = await tool.handler({});
    expect(res.content[0].text).toContain('No skills found');
  });

  it('ignores directories without SKILL.md', async () => {
    const tool = setup({ 'valid': '# Valid Skill' });
    const noSkillDir = path.join(tmpDir, 'skills', 'empty-dir');
    fs.mkdirSync(noSkillDir);
    const res = await tool.handler({});
    expect(res.content[0].text).toContain('Available skills (1)');
    expect(res.content[0].text).not.toContain('empty-dir');
  });

  it('prefers sdk-native .claude/skills over legacy skills/ when names collide', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    fs.mkdirSync(path.join(tmpDir, '.claude', 'skills', 'shared'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'skills', 'shared'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.claude', 'skills', 'shared', 'SKILL.md'), '# Native Shared\n');
    fs.writeFileSync(path.join(tmpDir, 'skills', 'shared', 'SKILL.md'), '# Legacy Shared\n');

    const tool = createListSkillsTool(tmpDir);
    const res = await tool.handler({});

    expect(res.content[0].text).toContain('Native Shared');
    expect(res.content[0].text).not.toContain('Legacy Shared');
    expect(res.content[0].text).toContain('[.claude/skills]');
  });

  it('can read sdk-native skills from .claude/skills', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    fs.mkdirSync(path.join(tmpDir, '.claude', 'skills', 'native-only'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.claude', 'skills', 'native-only', 'SKILL.md'), '# Native Only\n\nBody');

    const tool = createListSkillsTool(tmpDir);
    const res = await tool.handler({ skill_name: 'native-only' });

    expect(res.content[0].text).toContain('Body');
  });
});

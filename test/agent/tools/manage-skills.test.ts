import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createManageSkillsTool } from '../../../src/agent/tools/manage-skills.js';

describe('createManageSkillsTool', () => {
  let tmpDir: string;

  function setup(): ReturnType<typeof createManageSkillsTool> {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manage-skills-test-'));
    return createManageSkillsTool(tmpDir);
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('has correct name', () => {
    const tool = setup();
    expect(tool.name).toBe('manage_skills');
  });

  it('creates and reads a native skill', async () => {
    const tool = setup();
    const content = '# Example Skill\n\n## When to Use\nUse it.\n';

    const createResult = await tool.handler({
      action: 'create',
      skill_name: 'example-skill',
      content,
    });
    expect(createResult.isError).toBeUndefined();
    expect(createResult.content[0].text).toContain('Created native skill');

    const skillPath = path.join(tmpDir, '.claude', 'skills', 'example-skill', 'SKILL.md');
    expect(fs.readFileSync(skillPath, 'utf-8')).toBe(content);

    const readResult = await tool.handler({
      action: 'read',
      skill_name: 'example-skill',
    });
    expect(readResult.content[0].text).toBe(content);
  });

  it('updates an existing native skill', async () => {
    const tool = setup();
    const skillDir = path.join(tmpDir, '.claude', 'skills', 'example-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Old Skill\n');

    const updateResult = await tool.handler({
      action: 'update',
      skill_name: 'example-skill',
      content: '# New Skill\n\nUpdated body.\n',
    });

    expect(updateResult.isError).toBeUndefined();
    expect(updateResult.content[0].text).toContain('Updated native skill');
    expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8')).toContain('Updated body');
  });

  it('removes an existing native skill directory', async () => {
    const tool = setup();
    const skillDir = path.join(tmpDir, '.claude', 'skills', 'example-skill');
    fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Example Skill\n');
    fs.writeFileSync(path.join(skillDir, 'references', 'note.md'), 'note');

    const result = await tool.handler({
      action: 'remove',
      skill_name: 'example-skill',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Removed native skill');
    expect(fs.existsSync(skillDir)).toBe(false);
  });

  it('rejects invalid skill names and path traversal', async () => {
    const tool = setup();
    const result = await tool.handler({
      action: 'create',
      skill_name: '../evil',
      content: '# Evil\n',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid skill name');
  });

  it('rejects invalid frontmatter types', async () => {
    const tool = setup();
    const result = await tool.handler({
      action: 'create',
      skill_name: 'bad-skill',
      content: '---\ntags: bad\n---\n# Bad Skill\n',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Frontmatter field "tags" must be an array of strings.');
  });

  it('rejects duplicate create and missing update content', async () => {
    const tool = setup();
    const content = '# Example Skill\n';

    await tool.handler({
      action: 'create',
      skill_name: 'example-skill',
      content,
    });

    const duplicate = await tool.handler({
      action: 'create',
      skill_name: 'example-skill',
      content,
    });
    expect(duplicate.isError).toBe(true);
    expect(duplicate.content[0].text).toContain('Skill already exists');

    const missingContent = await tool.handler({
      action: 'update',
      skill_name: 'example-skill',
    });
    expect(missingContent.isError).toBe(true);
    expect(missingContent.content[0].text).toContain('content is required for update');
  });
});

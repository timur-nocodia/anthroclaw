import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import matter from 'gray-matter';

const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SKILL_BYTES = 128 * 1024;

export interface NativeSkillPathInfo {
  skillRoot: string;
  skillDir: string;
  skillPath: string;
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}/`);
}

export function resolveNativeSkillPaths(workspacePath: string, skillName: string): NativeSkillPathInfo {
  if (!SKILL_NAME_PATTERN.test(skillName)) {
    throw new Error('Invalid skill name. Use letters, numbers, dot, underscore, or dash only.');
  }

  const skillRoot = resolve(workspacePath, '.claude', 'skills');
  const skillDir = resolve(skillRoot, skillName);
  const skillPath = join(skillDir, 'SKILL.md');

  if (!isWithinRoot(skillDir, skillRoot) || !isWithinRoot(skillPath, skillRoot)) {
    throw new Error('Resolved skill path escapes the native skill root.');
  }

  return { skillRoot, skillDir, skillPath };
}

export function validateSkillDocument(content: string): void {
  const bytes = Buffer.byteLength(content, 'utf-8');
  if (bytes === 0) {
    throw new Error('Skill content must not be empty.');
  }
  if (bytes > MAX_SKILL_BYTES) {
    throw new Error(`Skill content exceeds ${MAX_SKILL_BYTES} bytes.`);
  }
  if (content.includes('\0')) {
    throw new Error('Skill content must not contain NUL bytes.');
  }

  const parsed = matter(content);
  const metadata = parsed.data as Record<string, unknown>;

  const stringFields = ['name', 'description'];
  for (const field of stringFields) {
    if (metadata[field] !== undefined && typeof metadata[field] !== 'string') {
      throw new Error(`Frontmatter field "${field}" must be a string.`);
    }
  }

  const arrayFields = ['tags', 'platforms'];
  for (const field of arrayFields) {
    const value = metadata[field];
    if (value !== undefined) {
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
        throw new Error(`Frontmatter field "${field}" must be an array of strings.`);
      }
    }
  }

  const body = parsed.content.trim();
  if (!body) {
    throw new Error('Skill body must not be empty.');
  }
  if (!body.split('\n').some((line) => line.trim().startsWith('#'))) {
    throw new Error('Skill body must include a markdown heading.');
  }
}

export function assertSkillExists(skillPath: string): void {
  if (!existsSync(skillPath)) {
    throw new Error('Skill does not exist.');
  }
}

export function assertSkillMissing(skillPath: string): void {
  if (existsSync(skillPath)) {
    throw new Error('Skill already exists.');
  }
}

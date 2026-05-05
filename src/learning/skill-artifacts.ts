import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LearningArtifactFileInput } from './artifacts.js';

const SKILL_NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;
const MAX_NEIGHBORHOOD_FILES_PER_DIR = 12;

export function expandActiveSkillArtifactFiles(input: {
  workspacePath: string;
  activeSkills: string[];
}): LearningArtifactFileInput[] {
  const files: LearningArtifactFileInput[] = [];
  const uniqueSkills = [...new Set(input.activeSkills)].filter((skill) => SKILL_NAME_RE.test(skill));

  for (const skillName of uniqueSkills) {
    const skillRoot = join(input.workspacePath, '.claude', 'skills', skillName);
    const skillPath = join(skillRoot, 'SKILL.md');
    if (!existsSync(skillPath)) continue;

    files.push({
      path: `.claude/skills/${skillName}/SKILL.md`,
      reason: `active skill ${skillName} guidance`,
    });
    files.push(...listNeighborhoodFiles(skillRoot, skillName, 'references'));
    files.push(...listNeighborhoodFiles(skillRoot, skillName, 'templates'));
  }

  return files;
}

function listNeighborhoodFiles(
  skillRoot: string,
  skillName: string,
  dirName: 'references' | 'templates',
): LearningArtifactFileInput[] {
  const dir = join(skillRoot, dirName);
  if (!existsSync(dir)) return [];

  const out: LearningArtifactFileInput[] = [];
  for (const entry of readdirSync(dir).sort().slice(0, MAX_NEIGHBORHOOD_FILES_PER_DIR)) {
    if (entry.startsWith('.')) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (!stat.isFile()) continue;
    out.push({
      path: `.claude/skills/${skillName}/${dirName}/${entry}`,
      reason: `active skill ${skillName} ${dirName} context`,
    });
  }
  return out;
}

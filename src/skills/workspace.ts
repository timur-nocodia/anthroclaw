import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const SKILL_ROOTS = [
  { relativePath: '.claude/skills', label: '.claude/skills', native: true },
  { relativePath: 'skills', label: 'skills', native: false },
] as const;

export interface WorkspaceSkill {
  name: string;
  title: string;
  description: string;
  tags: string[];
  platforms: string[];
  skillPath: string;
  sourceLabel: string;
  native: boolean;
}

export interface DiscoverWorkspaceSkillsParams {
  workspacePath: string;
  platform?: string;
}

export function discoverWorkspaceSkills(params: DiscoverWorkspaceSkillsParams): WorkspaceSkill[] {
  const discovered = new Map<string, WorkspaceSkill>();

  for (const root of SKILL_ROOTS) {
    const skillsDir = join(params.workspacePath, root.relativePath);
    if (!existsSync(skillsDir)) continue;

    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (discovered.has(entry.name)) continue;

      const skillPath = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;

      const raw = readFileSync(skillPath, 'utf-8');
      const parsed = matter(raw);
      const metadata = parsed.data as Record<string, unknown>;
      const platforms = Array.isArray(metadata.platforms)
        ? metadata.platforms.filter((value): value is string => typeof value === 'string')
        : [];

      if (params.platform && platforms.length > 0 && !platforms.includes(params.platform)) {
        continue;
      }

      const title = typeof metadata.name === 'string'
        ? metadata.name
        : (parsed.content.split('\n').find((line) => line.startsWith('#'))?.replace(/^#+\s*/, '') ?? entry.name);
      const description = typeof metadata.description === 'string' ? metadata.description : '';
      const tags = Array.isArray(metadata.tags)
        ? metadata.tags.filter((value): value is string => typeof value === 'string')
        : [];

      discovered.set(entry.name, {
        name: entry.name,
        title,
        description,
        tags,
        platforms,
        skillPath,
        sourceLabel: root.label,
        native: root.native,
      });
    }
  }

  return [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function readWorkspaceSkill(
  workspacePath: string,
  skillName: string,
): WorkspaceSkill | null {
  return discoverWorkspaceSkills({ workspacePath }).find((skill) => skill.name === skillName) ?? null;
}

export function listNativeProjectSkillNames(workspacePath: string): string[] {
  return discoverWorkspaceSkills({ workspacePath })
    .filter((skill) => skill.native)
    .map((skill) => skill.name);
}

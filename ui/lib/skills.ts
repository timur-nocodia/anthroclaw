import { resolve, join, basename } from 'node:path';
import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { NotFoundError, ValidationError } from './agents';

const AGENTS_DIR = resolve(process.cwd(), '..', 'agents');
const DATA_DIR = resolve(process.cwd(), '..', 'data');
const SKILL_CATALOG_DIR = join(DATA_DIR, 'skill-catalog');

// ─── Types ───────────────────────────────────────────────────────────

export interface SkillSummary {
  name: string;
  description: string;
  hasSkillMd: boolean;
  attached: boolean;
  catalog: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function agentDir(agentId: string): string {
  return join(AGENTS_DIR, agentId);
}

function agentSkillsDir(agentId: string): string {
  return join(agentDir(agentId), '.claude', 'skills');
}

function catalogDir(): string {
  return SKILL_CATALOG_DIR;
}

function catalogSkillDir(skillName: string): string {
  validateSkillName(skillName);
  return join(catalogDir(), skillName);
}

function ensureAgentExists(agentId: string): string {
  const agentPath = agentDir(agentId);
  if (!existsSync(agentPath) || !existsSync(join(agentPath, 'agent.yml'))) {
    throw new NotFoundError(agentId);
  }
  return agentPath;
}

function ensureAgentSkillsDir(agentId: string): string {
  ensureAgentExists(agentId);
  const dir = agentSkillsDir(agentId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function ensureCatalogDir(): string {
  const dir = catalogDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function validateSkillName(skillName: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(skillName)) {
    throw new ValidationError('invalid_skill_name', 'Skill name must match /^[a-z0-9][a-z0-9_-]{0,63}$/');
  }
}

function sanitizeSkillName(value: string): string {
  const normalized = value
    .replace(/\.git$/i, '')
    .replace(/[^a-z0-9_-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64);
  if (!normalized || !/^[a-z0-9]/.test(normalized)) {
    throw new ValidationError('invalid_skill_name', 'Could not derive a valid skill name');
  }
  return normalized;
}

function extractDescriptionFromMd(content: string): string {
  // First non-heading, non-empty line after frontmatter
  const { content: body } = matter(content);
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      return trimmed.slice(0, 120);
    }
  }
  return '';
}

// ─── Skill operations ────────────────────────────────────────────────

/**
 * List all skills for an agent.
 */
export function listSkills(agentId: string): SkillSummary[] {
  ensureAgentExists(agentId);

  const attachedDir = agentSkillsDir(agentId);
  const attached = new Set<string>();
  if (existsSync(attachedDir)) {
    for (const entry of readdirSync(attachedDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(attachedDir, entry.name, 'SKILL.md'))) {
        attached.add(entry.name);
      }
    }
  }

  const results = new Map<string, SkillSummary>();
  const catalog = catalogDir();
  if (existsSync(catalog)) {
    for (const entry of readdirSync(catalog, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = join(catalog, entry.name, 'SKILL.md');
      const hasSkillMd = existsSync(skillMdPath);
      let description = '';

      if (hasSkillMd) {
        try {
          const content = readFileSync(skillMdPath, 'utf-8');
          description = extractDescriptionFromMd(content);
        } catch {
          // ignore read errors
        }
      }

      results.set(entry.name, {
        name: entry.name,
        description,
        hasSkillMd,
        attached: attached.has(entry.name),
        catalog: true,
      });
    }
  }

  for (const name of attached) {
    if (results.has(name)) continue;
    const skillMdPath = join(attachedDir, name, 'SKILL.md');
    let description = '';
    try {
      description = extractDescriptionFromMd(readFileSync(skillMdPath, 'utf-8'));
    } catch {
      // ignore read errors
    }

    results.set(name, {
      name,
      description,
      hasSkillMd: true,
      attached: true,
      catalog: false,
    });
  }

  return [...results.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get a specific skill's SKILL.md content and frontmatter.
 */
export function getSkill(
  agentId: string,
  skillName: string,
): { name: string; content: string; frontmatter: Record<string, unknown>; attached: boolean; catalog: boolean } {
  validateSkillName(skillName);
  ensureAgentExists(agentId);

  const catalogPath = join(catalogSkillDir(skillName), 'SKILL.md');
  const attachedPath = join(agentSkillsDir(agentId), skillName, 'SKILL.md');
  const skillMdPath = existsSync(catalogPath) ? catalogPath : attachedPath;

  if (!existsSync(skillMdPath)) {
    throw new NotFoundError(`skills/${skillName}`);
  }

  const raw = readFileSync(skillMdPath, 'utf-8');
  const { content, data } = matter(raw);

  return {
    name: skillName,
    content,
    frontmatter: data,
    attached: existsSync(attachedPath),
    catalog: existsSync(catalogPath),
  };
}

/**
 * Attach a catalog skill to an agent by materializing it into .claude/skills.
 */
export function attachSkill(agentId: string, skillName: string, overwrite = true): void {
  validateSkillName(skillName);
  const sourceDir = catalogSkillDir(skillName);
  const sourceSkillMd = join(sourceDir, 'SKILL.md');
  if (!existsSync(sourceSkillMd)) {
    throw new NotFoundError(`skill-catalog/${skillName}`);
  }

  const dir = ensureAgentSkillsDir(agentId);
  const targetDir = join(dir, skillName);
  if (existsSync(targetDir)) {
    if (!overwrite) {
      throw new ValidationError('already_attached', `Skill "${skillName}" is already attached to agent "${agentId}"`);
    }
    rmSync(targetDir, { recursive: true, force: true });
  }

  copyDirRecursive(sourceDir, targetDir);
}

/**
 * Detach a skill from an agent by removing the materialized project-local copy.
 */
export function detachSkill(agentId: string, skillName: string): void {
  validateSkillName(skillName);
  ensureAgentExists(agentId);
  const skillDir = join(agentSkillsDir(agentId), skillName);

  if (!existsSync(skillDir)) {
    throw new NotFoundError(`${agentId}/.claude/skills/${skillName}`);
  }

  rmSync(skillDir, { recursive: true, force: true });
}

export const deleteSkill = detachSkill;

/**
 * Install a skill from a zip/tar.gz/tgz/.skill archive.
 * Extracts to a temp directory, imports into the instance catalog, and attaches it to the agent.
 */
export async function installSkillFromArchive(
  agentId: string,
  buffer: Buffer,
  filename: string,
  overwrite?: boolean,
): Promise<string> {
  ensureAgentExists(agentId);
  const dir = ensureCatalogDir();
  const tempDir = join(tmpdir(), `skill-install-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const archivePath = join(tempDir, filename);
    writeFileSync(archivePath, buffer);

    // Extract based on file extension
    const ext = filename.toLowerCase();
    if (ext.endsWith('.zip')) {
      execSync(`unzip -o "${archivePath}" -d "${tempDir}/extracted"`, { timeout: 30000 });
    } else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz') || ext.endsWith('.skill')) {
      mkdirSync(join(tempDir, 'extracted'), { recursive: true });
      execSync(`tar -xzf "${archivePath}" -C "${tempDir}/extracted"`, { timeout: 30000 });
    } else {
      throw new ValidationError('invalid_archive', `Unsupported archive format: ${filename}`);
    }

    // Find SKILL.md in the extracted contents
    const extractedDir = join(tempDir, 'extracted');
    const skillMdPath = findSkillMd(extractedDir);

    if (!skillMdPath) {
      throw new ValidationError('no_skill_md', 'Archive must contain a SKILL.md file');
    }

    // Determine skill name from the directory containing SKILL.md
    const skillParent = resolve(skillMdPath, '..');
    const rawSkillName = basename(skillParent) === 'extracted'
      ? basename(filename, filename.includes('.tar.gz') ? '.tar.gz' : '.' + filename.split('.').pop())
      : basename(skillParent);
    const skillName = sanitizeSkillName(rawSkillName);

    const targetDir = join(dir, skillName);

    if (existsSync(targetDir) && !overwrite) {
      throw new ValidationError('already_exists', `Skill "${skillName}" already exists`);
    }

    // Copy the skill directory
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    copyDirRecursive(skillParent === extractedDir ? extractedDir : skillParent, targetDir);
    attachSkill(agentId, skillName, true);

    return skillName;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Validate that a string is safe to use in a shell command argument.
 * Rejects strings containing shell metacharacters.
 */
function assertShellSafe(value: string, label: string): void {
  if (/[;&|`$(){}[\]!#~<>*?\n\r]/.test(value)) {
    throw new ValidationError('invalid_input', `${label} contains invalid characters`);
  }
}

/**
 * Install a skill from a git repository.
 */
export function installSkillFromGit(
  agentId: string,
  url: string,
  ref?: string,
  name?: string,
): string {
  assertShellSafe(url, 'Git URL');
  if (ref) assertShellSafe(ref, 'Git ref');

  ensureAgentExists(agentId);
  const dir = ensureCatalogDir();
  const tempDir = join(tmpdir(), `skill-git-${randomUUID()}`);

  try {
    const refArgs = ref ? `--branch "${ref}"` : '';
    execSync(`git clone --depth 1 ${refArgs} "${url}" "${tempDir}"`, {
      timeout: 60000,
      stdio: 'pipe',
    });

    // Check for SKILL.md
    const skillMdPath = findSkillMd(tempDir);
    if (!skillMdPath) {
      throw new ValidationError('no_skill_md', 'Repository must contain a SKILL.md file');
    }

    // Determine skill name
    const skillName = sanitizeSkillName(name ?? basename(url));
    const targetDir = join(dir, skillName);

    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }

    // Copy (excluding .git)
    const skillParent = resolve(skillMdPath, '..');
    const sourceDir = skillParent === tempDir ? tempDir : skillParent;
    copyDirRecursive(sourceDir, targetDir, ['.git']);
    attachSkill(agentId, skillName, true);

    return skillName;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ValidationError('clone_failed', message);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ─── Internal helpers ────────────────────────────────────────────────

function findSkillMd(dir: string, depth = 0): string | null {
  if (depth > 3) return null;

  const skillMd = join(dir, 'SKILL.md');
  if (existsSync(skillMd)) return skillMd;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const found = findSkillMd(join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  } catch {
    // ignore
  }

  return null;
}

function copyDirRecursive(src: string, dest: string, exclude: string[] = []): void {
  mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;

    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, exclude);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

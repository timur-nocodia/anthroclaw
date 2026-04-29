import { resolve, join, relative } from 'node:path';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  statSync,
} from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml, parseDocument } from 'yaml';
import { AgentYmlSchema } from '@backend/config/schema.js';
import { getDefaultProfile } from '@backend/security/profiles/index.js';

const AGENTS_DIR = resolve(process.cwd(), '..', 'agents');

// ─── Error classes ───────────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(public resource: string) {
    super(`Not found: ${resource}`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = 'ValidationError';
  }
}

// ─── Types ───────────────────────────────────────────────────────────

export interface AgentSummary {
  id: string;
  model: string;
  description?: string;
  routes: Array<{ channel: string; account?: string; scope?: string }>;
  skills?: string[];
  queue_mode?: string;
  session_policy?: string;
  hasClaudeMd: boolean;
  skillCount: number;
}

export interface AgentFile {
  name: string;
  size: number;
  updatedAt: string;
}

// ─── Agent CRUD ──────────────────────────────────────────────────────

function agentDir(agentId: string): string {
  return join(AGENTS_DIR, agentId);
}

function ensureAgentExists(agentId: string): string {
  const dir = agentDir(agentId);
  if (!existsSync(dir) || !existsSync(join(dir, 'agent.yml'))) {
    throw new NotFoundError(agentId);
  }
  return dir;
}

function validateAgentId(id: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id) || id.length > 64) {
    throw new ValidationError('invalid_id', 'Agent ID must match /^[a-z0-9][a-z0-9_-]*$/ and be <= 64 chars');
  }
}

/**
 * Scan the agents directory and return summaries.
 */
export function listAgents(): AgentSummary[] {
  if (!existsSync(AGENTS_DIR)) return [];

  const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
  const results: AgentSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const ymlPath = join(AGENTS_DIR, entry.name, 'agent.yml');
    if (!existsSync(ymlPath)) continue;

    try {
      const raw = readFileSync(ymlPath, 'utf-8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      const skillsDir = join(AGENTS_DIR, entry.name, '.claude', 'skills');
      let skillCount = 0;
      if (existsSync(skillsDir)) {
        skillCount = readdirSync(skillsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory()).length;
      }

      const routes = Array.isArray(parsed.routes)
        ? (parsed.routes as Array<Record<string, unknown>>).map((r) => ({
            channel: String(r.channel ?? ''),
            account: r.account ? String(r.account) : undefined,
            scope: r.scope ? String(r.scope) : undefined,
          }))
        : [];

      results.push({
        id: entry.name,
        model: (parsed.model as string) ?? 'claude-sonnet-4-6',
        description: parsed.description as string | undefined,
        routes,
        skills: Array.isArray(parsed.skills) ? (parsed.skills as string[]) : undefined,
        queue_mode: parsed.queue_mode as string | undefined,
        session_policy: parsed.session_policy as string | undefined,
        hasClaudeMd: existsSync(join(AGENTS_DIR, entry.name, 'CLAUDE.md')),
        skillCount,
      });
    } catch {
      // Skip malformed agents
    }
  }

  return results;
}

/**
 * Get an agent's config as raw YAML and parsed object.
 */
export function getAgentConfig(agentId: string): { raw: string; parsed: Record<string, unknown> } {
  const dir = ensureAgentExists(agentId);
  const raw = readFileSync(join(dir, 'agent.yml'), 'utf-8');
  const parsed = parseYaml(raw) as Record<string, unknown>;
  return { raw, parsed };
}

/**
 * Validate and write agent.yml.
 */
export function updateAgentConfig(agentId: string, yaml: string): void {
  const dir = ensureAgentExists(agentId);

  // Parse YAML to check syntax
  let data: unknown;
  try {
    data = parseYaml(yaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid YAML';
    throw new ValidationError('invalid_yaml', message);
  }

  // Validate against schema
  const result = AgentYmlSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError('invalid_yaml', issues);
  }

  writeFileSync(join(dir, 'agent.yml'), yaml, 'utf-8');
}

/**
 * Set the `enabled` flag for `plugins.<name>` inside `agent.yml`. Preserves
 * any other config keys under that plugin block. Creates the `plugins` block
 * (and the plugin entry) if they don't exist.
 *
 * Throws NotFoundError if the agent does not exist.
 */
export function setAgentPluginEnabled(
  agentId: string,
  pluginName: string,
  enabled: boolean,
): void {
  const dir = ensureAgentExists(agentId);
  const ymlPath = join(dir, 'agent.yml');
  const raw = readFileSync(ymlPath, 'utf-8');

  // parseDocument preserves comments, blank lines, key ordering, and anchors —
  // unlike the plain parse/stringify round-trip which strips all of these.
  // Operators hand-edit agent.yml with documentation comments; toggling a
  // plugin from the UI must not erase that work.
  const doc = parseDocument(raw);
  doc.setIn(['plugins', pluginName, 'enabled'], enabled);

  writeFileSync(ymlPath, doc.toString(), 'utf-8');
}

/**
 * Replace the per-plugin config block under `plugins.<name>` in the agent's
 * `agent.yml`, preserving comments and blank lines (via `parseDocument`).
 *
 * The replacement is a full overwrite of the keys *inside* `plugins.<name>` —
 * any keys not present in `config` are dropped. Comments / blank lines on the
 * surrounding document survive. The `enabled` flag is *not* special-cased
 * here: callers either include it in `config` or omit it (the A1 toggle
 * surface owns it).
 *
 * Throws NotFoundError if the agent does not exist.
 */
export function setAgentPluginConfig(
  agentId: string,
  pluginName: string,
  config: Record<string, unknown>,
): void {
  const dir = ensureAgentExists(agentId);
  const ymlPath = join(dir, 'agent.yml');
  const raw = readFileSync(ymlPath, 'utf-8');

  const doc = parseDocument(raw);
  // Preserve the existing `enabled` flag if the new block doesn't include it,
  // so the A1 toggle surface and the A2 config surface don't clobber each
  // other when used independently.
  if (!('enabled' in config)) {
    const existingEnabled = doc.getIn(['plugins', pluginName, 'enabled']);
    if (typeof existingEnabled === 'boolean') {
      config = { enabled: existingEnabled, ...config };
    }
  }
  doc.setIn(['plugins', pluginName], config);

  writeFileSync(ymlPath, doc.toString(), 'utf-8');
}

/**
 * Read `plugins.<name>` config block from `agent.yml`. Returns the raw config
 * (including `enabled`) or `{}` if the agent has no config for this plugin.
 *
 * Throws NotFoundError if the agent does not exist.
 */
export function getAgentPluginConfig(
  agentId: string,
  pluginName: string,
): Record<string, unknown> {
  const dir = ensureAgentExists(agentId);
  const ymlPath = join(dir, 'agent.yml');
  const raw = readFileSync(ymlPath, 'utf-8');
  const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;

  const plugins = parsed.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return {};
  const block = (plugins as Record<string, unknown>)[pluginName];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return {};
  return { ...(block as Record<string, unknown>) };
}

export function setAgentLearningConfig(
  agentId: string,
  learning: Record<string, unknown>,
): void {
  const dir = ensureAgentExists(agentId);
  const ymlPath = join(dir, 'agent.yml');
  const raw = readFileSync(ymlPath, 'utf-8');
  const doc = parseDocument(raw);
  doc.setIn(['learning'], learning);

  updateAgentConfig(agentId, doc.toString());
}

/**
 * Create a new agent directory with agent.yml, CLAUDE.md, memory/, .claude/skills/.
 */
export function createAgent(
  id: string,
  model?: string,
  template?: 'blank' | 'example',
): void {
  validateAgentId(id);

  const dir = agentDir(id);
  if (existsSync(dir)) {
    throw new ValidationError('already_exists', `Agent "${id}" already exists`);
  }

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'memory'), { recursive: true });
  mkdirSync(join(dir, '.claude', 'skills'), { recursive: true });

  const agentModel = model ?? 'claude-sonnet-4-6';

  if (template === 'example') {
    const config = {
      model: agentModel,
      safety_profile: getDefaultProfile(),
      timezone: 'UTC',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      pairing: { mode: 'off' },
      mcp_tools: ['memory_search', 'memory_write', 'send_message', 'list_skills', 'manage_cron'],
      queue_mode: 'collect',
    };
    writeFileSync(join(dir, 'agent.yml'), stringifyYaml(config), 'utf-8');
    writeFileSync(
      join(dir, 'CLAUDE.md'),
      `# ${id}\n\nYou are ${id}, a friendly conversational assistant available via messaging.\n\nBe warm and curious. Search memory before answering questions about past events. Write important facts to daily memory proactively.\n`,
      'utf-8',
    );
  } else {
    // blank template
    const config = {
      model: agentModel,
      safety_profile: getDefaultProfile(),
      routes: [{ channel: 'telegram', scope: 'dm' }],
    };
    writeFileSync(join(dir, 'agent.yml'), stringifyYaml(config), 'utf-8');
    writeFileSync(join(dir, 'CLAUDE.md'), `# ${id}\n`, 'utf-8');
  }
}

/**
 * Delete an agent directory entirely.
 */
export function deleteAgent(agentId: string): void {
  const dir = ensureAgentExists(agentId);
  rmSync(dir, { recursive: true, force: true });
}

// ─── File CRUD ───────────────────────────────────────────────────────

/**
 * Resolve a filename within an agent directory, guarding against path traversal.
 * Throws ValidationError if the resolved path escapes the agent directory.
 */
function safeFilePath(dir: string, filename: string): string {
  const resolved = resolve(dir, filename);
  const rel = relative(dir, resolved);
  if (rel.startsWith('..') || rel.includes('/') || rel.includes('\\')) {
    throw new ValidationError('invalid_filename', 'Filename must not contain path separators or traverse directories');
  }
  return resolved;
}

/**
 * List files in an agent's directory (top-level only, excludes subdirectories).
 */
export function listAgentFiles(agentId: string): AgentFile[] {
  const dir = ensureAgentExists(agentId);
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: AgentFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;

    const stat = statSync(join(dir, entry.name));
    files.push({
      name: entry.name,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    });
  }

  return files;
}

/**
 * Get a specific file's content from an agent directory.
 */
export function getAgentFile(
  agentId: string,
  filename: string,
): { name: string; content: string; updatedAt: string } {
  const dir = ensureAgentExists(agentId);
  const filePath = safeFilePath(dir, filename);

  if (!existsSync(filePath)) {
    throw new NotFoundError(`${agentId}/${filename}`);
  }

  const stat = statSync(filePath);
  if (!stat.isFile()) {
    throw new NotFoundError(`${agentId}/${filename}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  return { name: filename, content, updatedAt: stat.mtime.toISOString() };
}

/**
 * Write (create or overwrite) a file in an agent directory.
 */
export function writeAgentFile(agentId: string, filename: string, content: string): void {
  const dir = ensureAgentExists(agentId);
  writeFileSync(safeFilePath(dir, filename), content, 'utf-8');
}

/**
 * Delete a file from an agent directory. Refuses to delete CLAUDE.md.
 */
export function deleteAgentFile(agentId: string, filename: string): void {
  if (filename === 'CLAUDE.md') {
    throw new ValidationError('cannot_delete', 'CLAUDE.md is required');
  }

  const dir = ensureAgentExists(agentId);
  const filePath = safeFilePath(dir, filename);

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new NotFoundError(`${agentId}/${filename}`);
  }

  rmSync(filePath);
}

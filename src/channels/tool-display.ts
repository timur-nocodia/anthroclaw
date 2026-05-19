const TOOL_EMOJI: Record<string, string> = {
  // Built-in runtime/provider tools
  Bash: '💻',
  Read: '📖',
  Write: '✏️',
  Edit: '✏️',
  NotebookEdit: '✏️',
  Grep: '🔎',
  Glob: '🔍',
  Task: '🎯',
  TodoWrite: '✅',
  WebFetch: '🌐',
  WebSearch: '🔎',

  // AnthroClaw built-ins
  memory_search: '🧠',
  memory_write: '🧠',
  memory_wiki: '🧠',
  web_search_brave: '🔎',
  web_search_exa: '🔎',
  list_skills: '📚',
  manage_skills: '📚',
  manage_cron: '⏰',
  send_message: '📤',
  send_media: '📤',
  access_control: '🔐',
  escalate: '🆘',
  connect_mcp: '🔌',
  local_note_propose: '📝',
  local_note_search: '📝',
  manage_human_takeover: '👤',
  manage_notifications: '🔔',
  manage_operator_console: '🎛️',
  session_search: '🕘',
  show_config: '⚙️',
  buildroom_submit_signal: '🏗️',
  buildroom_submit_session_summary: '🏗️',

  // Synthetic names emitted by resolveToolDisplay for skill-file ops
  skill_read: '📚',
  skill_write: '📚',
  skill_edit: '📚',
};

const FALLBACK_EMOJI = '⚡';
const MCP_EMOJI = '🔌';

export function getToolEmoji(toolName: string, overrides?: Record<string, string>): string {
  if (overrides && overrides[toolName]) return overrides[toolName];
  if (TOOL_EMOJI[toolName]) return TOOL_EMOJI[toolName];
  if (toolName.startsWith('mcp__')) return MCP_EMOJI;
  return FALLBACK_EMOJI;
}

/** Map of tool name → primary argument field for preview building. */
const PRIMARY_ARG: Record<string, string> = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'pattern',
  Glob: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
  web_search_brave: 'query',
  web_search_exa: 'query',
  memory_search: 'query',
  memory_write: 'content',
  manage_cron: 'action',
  manage_skills: 'action',
  local_note_search: 'query',
  local_note_propose: 'note',
  session_search: 'query',
  escalate: 'reason',
  connect_mcp: 'action',
  manage_human_takeover: 'action',
  manage_notifications: 'action',
  manage_operator_console: 'action',
};

const PATH_TAIL_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit']);
const FILE_OP_TOOLS = new Set(['Read', 'Write', 'Edit']);

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function truncate(s: string, maxLen: number): string {
  if (maxLen <= 0 || s.length <= maxLen) return s;
  if (maxLen <= 1) return '…';
  return s.slice(0, maxLen - 1) + '…';
}

function pathTail(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/** Match `.claude/skills/<name>/...`, `skills/<name>/...`, or `agents/<id>/skills/<name>/...`. */
const SKILL_PATH_RE = /(?:^|\/)(?:\.claude|agents\/[^/]+|plugins\/[^/]+)?\/?skills\/([^/]+)/;

function extractSkillName(filePath: string): string | null {
  const match = SKILL_PATH_RE.exec(filePath);
  return match ? match[1] : null;
}

export function buildToolPreview(
  toolName: string,
  input: unknown,
  maxLen: number,
): string | null {
  if (maxLen <= 0) return null;
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;

  // Special: Task → description else prompt
  if (toolName === 'Task') {
    const val = (typeof obj.description === 'string' && obj.description)
      || (typeof obj.prompt === 'string' && obj.prompt);
    if (!val) return null;
    return truncate(oneLine(val), maxLen);
  }

  // Synthetic skill ops carry the skill name in `_skill_name` set by resolveToolDisplay
  if (toolName === 'skill_read' || toolName === 'skill_write' || toolName === 'skill_edit') {
    const skill = typeof obj._skill_name === 'string' ? obj._skill_name : null;
    return skill ? truncate(oneLine(skill), maxLen) : null;
  }

  // Primary arg by tool name
  const key = PRIMARY_ARG[toolName];
  if (key && typeof obj[key] === 'string') {
    const raw = obj[key] as string;
    const value = PATH_TAIL_TOOLS.has(toolName) ? pathTail(raw) : oneLine(raw);
    return truncate(value, maxLen);
  }

  // Fallback: first string field in input
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v.length > 0) {
      return truncate(oneLine(v), maxLen);
    }
  }
  return null;
}

export interface ToolDisplay {
  /** Emoji prefix for the bubble line. */
  emoji: string;
  /** Tool name to render (may be synthetic, e.g. `skill_read` for skill-file Reads). */
  displayName: string;
  /** Short preview (primary arg / skill name / etc.) or null. */
  preview: string | null;
}

/**
 * Resolve emoji + display name + preview for one tool call.
 *
 * Detects skill-file reads/writes (file_path under `.claude/skills/<name>/`,
 * `agents/<id>/skills/<name>/`, `plugins/<id>/skills/<name>/`, or bare
 * `skills/<name>/`) and surfaces them as `📚 skill_read: <name>` instead of
 * the raw filename — same pattern Hermes uses for `skill_view`.
 */
export function resolveToolDisplay(
  toolName: string,
  input: unknown,
  previewLength: number,
  emojiOverrides?: Record<string, string>,
): ToolDisplay {
  if (FILE_OP_TOOLS.has(toolName) && input && typeof input === 'object') {
    const filePath = (input as Record<string, unknown>).file_path;
    if (typeof filePath === 'string') {
      const skillName = extractSkillName(filePath);
      if (skillName) {
        const synthetic = toolName === 'Read'
          ? 'skill_read'
          : toolName === 'Write'
            ? 'skill_write'
            : 'skill_edit';
        return {
          emoji: getToolEmoji(synthetic, emojiOverrides),
          displayName: synthetic,
          preview: buildToolPreview(synthetic, { _skill_name: skillName }, previewLength),
        };
      }
    }
  }

  return {
    emoji: getToolEmoji(toolName, emojiOverrides),
    displayName: toolName,
    preview: buildToolPreview(toolName, input, previewLength),
  };
}

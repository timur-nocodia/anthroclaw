const TOOL_EMOJI: Record<string, string> = {
  // Built-in Claude Code tools
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
  manage_cron: '⏰',
  send_message: '📤',
  send_media: '📤',
  access_control: '🔐',
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
};

const PATH_TAIL_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit']);

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

export type ProfileName = 'public' | 'trusted' | 'private' | 'chat_like_openclaw';

export type ToolCategory =
  | 'read-only'         // Read, Glob, Grep, LS, memory_search, memory_wiki
  | 'code-exec'         // Bash, Write, Edit, MultiEdit, NotebookEdit
  | 'network'           // WebFetch, web_search_*
  | 'messaging'         // send_message, send_media
  | 'memory-write'      // memory_write, local_note_propose
  | 'agent-config'      // manage_cron, manage_skills, access_control
  | 'session-introspect'; // session_search, list_skills, local_note_search

export interface ToolMeta {
  category: ToolCategory;
  safe_in_public: boolean;
  safe_in_trusted: boolean;
  safe_in_private: boolean;
  destructive: boolean;        // requires approval in trusted (and optionally private)
  reads_only: boolean;
  hard_blacklist_in: ProfileName[]; // override cannot open this tool in these profiles
  description?: string;        // human-readable summary surfaced to operators
  reasoning?: string;          // why the safety classification was chosen
}

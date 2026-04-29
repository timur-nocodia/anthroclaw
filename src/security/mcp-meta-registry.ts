import type { ToolMeta } from './types.js';
import { META as manageCronMeta } from '../agent/tools/manage-cron.js';
import { META as manageSkillsMeta } from '../agent/tools/manage-skills.js';
import { META as accessControlMeta } from '../agent/tools/access-control.js';
import { META as memorySearchMeta } from '../agent/tools/memory-search.js';
import { META as memoryWriteMeta } from '../agent/tools/memory-write.js';
import { META as memoryWikiMeta } from '../agent/tools/memory-wiki.js';
import { META as sendMessageMeta } from '../agent/tools/send-message.js';
import { META as sendMediaMeta } from '../agent/tools/send-media.js';
import { META as webSearchMeta } from '../agent/tools/web-search.js';
import { META as listSkillsMeta } from '../agent/tools/list-skills.js';
import { META as localNoteSearchMeta } from '../agent/tools/local-note-search.js';
import { META as localNoteProposeMeta } from '../agent/tools/local-note-propose.js';
import { META as sessionSearchMeta } from '../agent/tools/session-search.js';

export const MCP_META: Record<string, ToolMeta> = {
  manage_cron: manageCronMeta,
  manage_skills: manageSkillsMeta,
  access_control: accessControlMeta,
  memory_search: memorySearchMeta,
  memory_write: memoryWriteMeta,
  memory_wiki: memoryWikiMeta,
  send_message: sendMessageMeta,
  send_media: sendMediaMeta,
  web_search_brave: webSearchMeta,
  web_search_exa: webSearchMeta,
  list_skills: listSkillsMeta,
  local_note_search: localNoteSearchMeta,
  local_note_propose: localNoteProposeMeta,
  session_search: sessionSearchMeta,
};

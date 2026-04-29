import { describe, it, expect } from 'vitest';
import { META as manageCronMeta } from '../manage-cron.js';
import { META as manageSkillsMeta } from '../manage-skills.js';
import { META as accessControlMeta } from '../access-control.js';
import { META as memorySearchMeta } from '../memory-search.js';
import { META as memoryWriteMeta } from '../memory-write.js';
import { META as memoryWikiMeta } from '../memory-wiki.js';
import { META as sendMessageMeta } from '../send-message.js';
import { META as sendMediaMeta } from '../send-media.js';
import { META as webSearchMeta } from '../web-search.js';
import { META as listSkillsMeta } from '../list-skills.js';
import { META as localNoteSearchMeta } from '../local-note-search.js';
import { META as localNoteProposeMeta } from '../local-note-propose.js';
import { META as sessionSearchMeta } from '../session-search.js';

describe('MCP tool META', () => {
  it('memory_search: read-only, safe everywhere', () => {
    expect(memorySearchMeta.reads_only).toBe(true);
    expect(memorySearchMeta.safe_in_public).toBe(true);
    expect(memorySearchMeta.destructive).toBe(false);
  });

  it('memory_write: not safe in public, no destructive approval needed in trusted', () => {
    expect(memoryWriteMeta.safe_in_public).toBe(false);
    expect(memoryWriteMeta.safe_in_trusted).toBe(true);
    expect(memoryWriteMeta.destructive).toBe(false);
  });

  it('manage_cron: forbidden in public via hard_blacklist, destructive in trusted', () => {
    expect(manageCronMeta.safe_in_public).toBe(false);
    expect(manageCronMeta.hard_blacklist_in).toContain('public');
    expect(manageCronMeta.safe_in_trusted).toBe(true);
    expect(manageCronMeta.destructive).toBe(true);
  });

  it('access_control: hard_blacklist in public AND trusted', () => {
    expect(accessControlMeta.hard_blacklist_in).toEqual(expect.arrayContaining(['public', 'trusted']));
    expect(accessControlMeta.safe_in_private).toBe(true);
  });

  it('manage_skills: hard_blacklist in public AND trusted', () => {
    expect(manageSkillsMeta.hard_blacklist_in).toEqual(expect.arrayContaining(['public', 'trusted']));
  });

  it('send_message: safe in public', () => {
    expect(sendMessageMeta.safe_in_public).toBe(true);
  });

  it('send_media: not safe in public, destructive in trusted', () => {
    expect(sendMediaMeta.safe_in_public).toBe(false);
    expect(sendMediaMeta.safe_in_trusted).toBe(true);
    expect(sendMediaMeta.destructive).toBe(true);
  });

  it('web_search: safe in public', () => {
    expect(webSearchMeta.safe_in_public).toBe(true);
    expect(webSearchMeta.reads_only).toBe(true);
  });

  it('memory_wiki: safe in public, read-only', () => {
    expect(memoryWikiMeta.safe_in_public).toBe(true);
    expect(memoryWikiMeta.reads_only).toBe(true);
  });

  it('list_skills: safe in public, read-only', () => {
    expect(listSkillsMeta.safe_in_public).toBe(true);
    expect(listSkillsMeta.reads_only).toBe(true);
  });

  it('local_note_search: not safe in public', () => {
    expect(localNoteSearchMeta.safe_in_public).toBe(false);
    expect(localNoteSearchMeta.safe_in_trusted).toBe(true);
  });

  it('local_note_propose: destructive, not safe in public', () => {
    expect(localNoteProposeMeta.safe_in_public).toBe(false);
    expect(localNoteProposeMeta.destructive).toBe(true);
  });

  it('session_search: not safe in public', () => {
    expect(sessionSearchMeta.safe_in_public).toBe(false);
  });
});

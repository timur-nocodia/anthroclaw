import type {
  Options,
  SDKSessionInfo,
  SessionMessage,
  SessionStoreEntry,
  SessionStore,
} from '@anthropic-ai/claude-agent-sdk';
import {
  deleteSession,
  forkSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
} from '@anthropic-ai/claude-agent-sdk';
import type { Agent } from '../agent/agent.js';

export interface SdkSessionServiceOptions {
  sessionStore: SessionStore;
  loadTimeoutMs?: number;
}

export interface ForkAgentSessionParams {
  sourceSessionId: string;
  upToMessageId?: string;
  title?: string;
}

export interface ListAgentSessionsParams {
  limit?: number;
  offset?: number;
}

export interface GetAgentSessionMessagesParams {
  limit?: number;
  offset?: number;
  includeSystemMessages?: boolean;
}

export interface SdkSessionMessageView {
  type: SessionMessage['type'];
  uuid: string;
  sessionId: string;
  text: string;
  message: unknown;
}

interface SessionTitleEntry {
  type: 'session_title';
  timestamp: string;
  title: string;
}

interface SessionLabelsEntry {
  type: 'session_labels';
  timestamp: string;
  labels: string[];
}

const SESSION_TITLE_SUBPATH = '__session_title';
const SESSION_LABELS_SUBPATH = '__session_labels';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        const record = asRecord(block);
        if (typeof record.text === 'string') return record.text;
        if (typeof record.content === 'string') return record.content;
        return '';
      })
      .filter(Boolean)
      .join('');
  }

  return '';
}

export function normalizeSessionMessage(message: SessionMessage): SdkSessionMessageView {
  const payload = asRecord(message.message);
  const text = extractTextFromContent(payload.content)
    || extractTextFromContent(payload.message)
    || (typeof message.message === 'string' ? message.message : '');

  return {
    type: message.type,
    uuid: message.uuid,
    sessionId: message.session_id,
    text,
    message: message.message,
  };
}

export class SdkSessionService {
  readonly sessionStore: SessionStore;
  readonly loadTimeoutMs?: number;

  constructor(options: SdkSessionServiceOptions) {
    this.sessionStore = options.sessionStore;
    this.loadTimeoutMs = options.loadTimeoutMs;
  }

  getQueryOptions(): Pick<Options, 'sessionStore' | 'loadTimeoutMs'> {
    return {
      sessionStore: this.sessionStore,
      loadTimeoutMs: this.loadTimeoutMs,
    };
  }

  getResumeSessionId(agent: Agent, sessionKey: string): string | undefined {
    return agent.getSessionId(sessionKey);
  }

  rememberSessionId(agent: Agent, sessionKey: string, sessionId: string): void {
    agent.setSessionId(sessionKey, sessionId);
  }

  clearSession(agent: Agent, sessionKey: string): void {
    agent.clearSession(sessionKey);
  }

  async listAgentSessions(agent: Agent, params: ListAgentSessionsParams = {}): Promise<SDKSessionInfo[]> {
    try {
      return await listSessions({
        dir: agent.workspacePath,
        limit: params.limit,
        offset: params.offset,
        sessionStore: this.sessionStore,
      });
    } catch {
      const store = this.sessionStore as SessionStore & {
        listSessions?: (projectKey: string) => Promise<Array<{ sessionId: string; mtime: number }>>;
      };
      if (!store.listSessions) return [];

      const sessions = await store.listSessions(agent.workspacePath);
      const start = params.offset ?? 0;
      const end = params.limit ? start + params.limit : undefined;
      return sessions.slice(start, end).map((session) => ({
        sessionId: session.sessionId,
        summary: session.sessionId,
        lastModified: session.mtime,
        cwd: agent.workspacePath,
      }));
    }
  }

  async getAgentSessionInfo(agent: Agent, sessionId: string): Promise<SDKSessionInfo | undefined> {
    return getSessionInfo(sessionId, {
      dir: agent.workspacePath,
      sessionStore: this.sessionStore,
    });
  }

  async getAgentSessionTitle(agent: Agent, sessionId: string): Promise<string | undefined> {
    const entries = await this.sessionStore.load({
      projectKey: agent.workspacePath,
      sessionId,
      subpath: SESSION_TITLE_SUBPATH,
    }) as Array<Partial<SessionTitleEntry>> | null;

    if (!entries || entries.length === 0) return undefined;
    const latest = entries.at(-1);
    return typeof latest?.title === 'string' && latest.title.trim().length > 0
      ? latest.title.trim()
      : undefined;
  }

  async setAgentSessionTitle(agent: Agent, sessionId: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;

    if (typeof this.sessionStore.delete === 'function') {
      await this.sessionStore.delete({
        projectKey: agent.workspacePath,
        sessionId,
        subpath: SESSION_TITLE_SUBPATH,
      }).catch(() => {});
    }

    await this.sessionStore.append({
      projectKey: agent.workspacePath,
      sessionId,
      subpath: SESSION_TITLE_SUBPATH,
    }, [{
      type: 'session_title',
      timestamp: new Date().toISOString(),
      title: trimmed,
    } as unknown as SessionStoreEntry]);
  }

  async getAgentSessionLabels(agent: Agent, sessionId: string): Promise<string[]> {
    const entries = await this.sessionStore.load({
      projectKey: agent.workspacePath,
      sessionId,
      subpath: SESSION_LABELS_SUBPATH,
    }) as Array<Partial<SessionLabelsEntry>> | null;

    if (!entries || entries.length === 0) return [];
    const latest = entries.at(-1);
    return normalizeLabels(latest?.labels);
  }

  async setAgentSessionLabels(agent: Agent, sessionId: string, labels: string[]): Promise<string[]> {
    const normalized = normalizeLabels(labels);

    if (typeof this.sessionStore.delete === 'function') {
      await this.sessionStore.delete({
        projectKey: agent.workspacePath,
        sessionId,
        subpath: SESSION_LABELS_SUBPATH,
      }).catch(() => {});
    }

    await this.sessionStore.append({
      projectKey: agent.workspacePath,
      sessionId,
      subpath: SESSION_LABELS_SUBPATH,
    }, [{
      type: 'session_labels',
      timestamp: new Date().toISOString(),
      labels: normalized,
    } as unknown as SessionStoreEntry]);

    return normalized;
  }

  async getAgentSessionMessages(
    agent: Agent,
    sessionId: string,
    params: GetAgentSessionMessagesParams = {},
  ): Promise<SdkSessionMessageView[]> {
    const messages = await getSessionMessages(sessionId, {
      dir: agent.workspacePath,
      limit: params.limit,
      offset: params.offset,
      includeSystemMessages: params.includeSystemMessages,
      sessionStore: this.sessionStore,
    });
    return messages.map(normalizeSessionMessage);
  }

  async forkAgentSession(agent: Agent, params: ForkAgentSessionParams): ReturnType<typeof forkSession> {
    const forked = await forkSession(params.sourceSessionId, {
      dir: agent.workspacePath,
      sessionStore: this.sessionStore,
      upToMessageId: params.upToMessageId,
      title: params.title,
    });

    if (params.title) {
      await this.setAgentSessionTitle(agent, forked.sessionId, params.title).catch(() => {});
    }

    return forked;
  }

  async deleteAgentSession(agent: Agent, sessionId: string): Promise<void> {
    await deleteSession(sessionId, {
      dir: agent.workspacePath,
      sessionStore: this.sessionStore,
    });
  }
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label) => label.slice(0, 64))))
    .slice(0, 10);
}

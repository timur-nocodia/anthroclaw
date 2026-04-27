"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  ArrowDown,
  Bot,
  ChevronDown,
  Download,
  FileText,
  GitFork,
  History,
  MoreHorizontal,
  Pause,
  RefreshCw,
  RotateCcw,
  Send,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";
import { MessageBubble, type ChatMessage, type ToolCall } from "@/components/chat-message";
import { storedEntriesToChatMessages } from "@/lib/normalize-session";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentSummary {
  id: string;
  model?: string;
}

interface AgentSession {
  sessionId: string;
  summary: string;
  tag?: string;
  customTitle?: string;
  labels?: string[];
  lastModified: number;
  activeKeys?: string[];
  messageCount?: number;
  provenance?: {
    runId: string;
    source: "channel" | "web" | "cron";
    channel: string;
    accountId?: string;
    peerId?: string;
    threadId?: string;
    messageId?: string;
    sessionKey: string;
    routeDecisionId?: string;
    routeOutcome?: string;
    startedAt: number;
    completedAt?: number;
    status: "running" | "succeeded" | "failed" | "interrupted";
  };
  firstMessage?: {
    type: string;
    uuid: string;
    text: string;
  };
  lastMessage?: {
    type: string;
    uuid: string;
    text: string;
  };
}

interface SessionMessageView {
  type: "user" | "assistant" | "system";
  uuid: string;
  sessionId?: string;
  text: string;
  message?: unknown;
}

interface SessionDetails {
  sessionId: string;
  summary?: string;
  lastModified?: number;
  messages: SessionMessageView[];
}

interface RouteDecisionCandidate {
  agentId: string;
  channel: string;
  accountId: string;
  scope: string;
  peers?: string[];
  topics?: string[];
  mentionOnly: boolean;
  priority: number;
}

interface RouteDecision {
  id: string;
  timestamp?: number;
  messageId?: string;
  channel: string;
  accountId: string;
  chatType: string;
  peerId: string;
  senderId: string;
  threadId?: string;
  candidates: RouteDecisionCandidate[];
  winnerAgentId?: string;
  accessAllowed?: boolean;
  accessReason?: string;
  queueAction?: string;
  sessionKey?: string;
  outcome: string;
}

interface RewindResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
  userMessageId?: string;
}

interface SubagentRun {
  runId: string;
  agentId: string;
  parentSessionId: string;
  parentSessionKeys?: string[];
  subagentId: string;
  subagentType?: string;
  status: "running" | "completed";
  startedAt: number;
  finishedAt?: number;
  cwd?: string;
  permissionMode?: string;
  parentTranscriptPath?: string;
  subagentTranscriptPath?: string;
  lastAssistantMessage?: string;
  interruptSupported?: boolean;
  interruptScope?: "parent_session";
  interruptReason?: string;
  policy?: {
    kind: "explorer" | "worker" | "custom";
    writePolicy: "allow" | "deny" | "claim_required";
    conflictMode: "soft" | "strict";
    description?: string;
  };
  toolSummary?: {
    started: number;
    completed: number;
    failed: number;
    toolNames: string[];
    lastToolName?: string;
    lastStatus?: "started" | "completed" | "failed";
    lastAt?: number;
  };
}

interface HookEventView {
  id: string;
  type: "hook_started" | "hook_progress" | "hook_response";
  hookId?: string;
  hookName?: string;
  hookEvent?: string;
  output?: string;
  stdout?: string;
  stderr?: string;
  outcome?: string;
  ts: Date;
}

interface ActiveRunView {
  sessionKey: string;
  registeredAt: number;
  lastActivityAt: number;
  lastEventType: string;
  activeTaskIds: string[];
  traceId?: string;
  agentId?: string;
  runId?: string;
  sdkSessionId?: string;
  channelDeliveryTarget?: {
    channel: string;
    peerId: string;
    accountId?: string;
    threadId?: string;
  };
}

interface InterruptRecord {
  id?: number;
  timestamp?: number;
  agentId?: string;
  runId?: string;
  sessionKey?: string;
  sdkSessionId?: string;
  targetId: string;
  requestedBy?: string;
  result: "interrupted" | "failed";
  reason?: string;
}

interface FileOwnershipClaim {
  claimId: string;
  sessionKey: string;
  runId: string;
  subagentId: string;
  path: string;
  mode: "read" | "write";
  claimedAt: number;
  expiresAt: number;
}

interface FileOwnershipConflict {
  conflictId: string;
  sessionKey: string;
  path: string;
  requested: FileOwnershipClaim;
  existing: FileOwnershipClaim;
  action: "allow" | "deny";
  reason: string;
  createdAt: number;
}

interface FileOwnershipView {
  claims: FileOwnershipClaim[];
  conflicts: FileOwnershipConflict[];
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const serverId = params.serverId as string;
  const agentId = params.agentId as string;

  const storageKey = `chat_${serverId}_${agentId}`;

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selected, setSelected] = useState(agentId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState(() => {
    if (typeof window === "undefined") return "sess_" + Math.random().toString(36).slice(2, 10);
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.sessionId ?? "sess_" + Math.random().toString(36).slice(2, 10);
      }
    } catch {}
    return "sess_" + Math.random().toString(36).slice(2, 10);
  });
  const [totalTokens, setTotalTokens] = useState(0);
  const [promptSuggestion, setPromptSuggestion] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionSearchFilter, setSessionSearchFilter] = useState("");
  const [sessionLabelFilter, setSessionLabelFilter] = useState("");
  const [sessionSourceFilter, setSessionSourceFilter] = useState<"all" | "web" | "channel" | "cron">("all");
  const [sessionStatusFilter, setSessionStatusFilter] = useState<"all" | "running" | "succeeded" | "failed" | "interrupted">("all");
  const [sessionActiveFilter, setSessionActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [sessionChannelFilter, setSessionChannelFilter] = useState("");
  const [sessionErrorsOnly, setSessionErrorsOnly] = useState(false);
  const [sessionRouteDecisionOnly, setSessionRouteDecisionOnly] = useState(false);
  const [sessionModifiedAfterFilter, setSessionModifiedAfterFilter] = useState("");
  const [sessionModifiedBeforeFilter, setSessionModifiedBeforeFilter] = useState("");
  const [showSessionFilters, setShowSessionFilters] = useState(false);
  const [sessionDetails, setSessionDetails] = useState<SessionDetails | null>(null);
  const [sessionDetailsLoading, setSessionDetailsLoading] = useState(false);
  const [routeDecision, setRouteDecision] = useState<RouteDecision | null>(null);
  const [routeDecisionLoading, setRouteDecisionLoading] = useState(false);
  const [subagentRuns, setSubagentRuns] = useState<SubagentRun[]>([]);
  const [subagentsLoading, setSubagentsLoading] = useState(false);
  const [activeRuns, setActiveRuns] = useState<ActiveRunView[]>([]);
  const [activeRunsLoading, setActiveRunsLoading] = useState(false);
  const [interrupts, setInterrupts] = useState<InterruptRecord[]>([]);
  const [interruptsLoading, setInterruptsLoading] = useState(false);
  const [fileOwnership, setFileOwnership] = useState<FileOwnershipView>({ claims: [], conflicts: [] });
  const [fileOwnershipLoading, setFileOwnershipLoading] = useState(false);
  const [hookEvents, setHookEvents] = useState<HookEventView[]>([]);
  const [rewindNotice, setRewindNotice] = useState<string | null>(null);
  const [channel, setChannel] = useState("web");
  const [chatType, setChatType] = useState("dm");
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stuckToBottom = useRef(true);

  // Restore messages from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
          setMessages(
            parsed.messages.map((m: ChatMessage) => ({
              ...m,
              ts: new Date(m.ts),
              streaming: false,
            })),
          );
        }
      }
    } catch {}
  }, [storageKey]);

  // Persist messages to localStorage
  useEffect(() => {
    if (messages.length === 0) return;
    const nonStreaming = messages.filter((m) => !m.streaming);
    if (nonStreaming.length === 0) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ sessionId, messages: nonStreaming }),
      );
    } catch {}
  }, [messages, sessionId, storageKey]);

  // Fetch agent list
  useEffect(() => {
    fetch(`/api/fleet/${serverId}/agents`)
      .then((r) => r.json())
      .then((d) => setAgents(Array.isArray(d) ? d : d.agents ?? []))
      .catch(() => {});
  }, [serverId]);

  const agent = agents.find((a) => a.id === selected);
  const selectedSession = sessions.find((session) => session.sessionId === sessionId);
  const selectedRouteDecisionId = selectedSession?.provenance?.routeDecisionId;
  const activeSessionFilterCount = [
    sessionSearchFilter.trim(),
    sessionLabelFilter.trim(),
    sessionSourceFilter !== "all",
    sessionStatusFilter !== "all",
    sessionActiveFilter !== "all",
    sessionChannelFilter.trim(),
    sessionErrorsOnly,
    sessionRouteDecisionOnly,
    sessionModifiedAfterFilter,
    sessionModifiedBeforeFilter,
  ].filter(Boolean).length;
  const sessionFiltersOpen = showSessionFilters || activeSessionFilterCount > 0;

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const query = new URLSearchParams({ limit: "25" });
      const search = sessionSearchFilter.trim();
      const label = sessionLabelFilter.trim();
      const channelFilter = sessionChannelFilter.trim();
      if (search) query.set("search", search);
      if (label) query.set("label", label);
      if (sessionSourceFilter !== "all") query.set("source", sessionSourceFilter);
      if (sessionStatusFilter !== "all") query.set("status", sessionStatusFilter);
      if (sessionActiveFilter !== "all") query.set("active", sessionActiveFilter);
      if (channelFilter) query.set("channel", channelFilter);
      if (sessionErrorsOnly) query.set("hasErrors", "true");
      if (sessionRouteDecisionOnly) query.set("hasRouteDecision", "true");
      if (sessionModifiedAfterFilter) {
        const modifiedAfter = new Date(`${sessionModifiedAfterFilter}T00:00:00`).getTime();
        if (Number.isFinite(modifiedAfter)) query.set("modifiedAfter", String(modifiedAfter));
      }
      if (sessionModifiedBeforeFilter) {
        const modifiedBefore = new Date(`${sessionModifiedBeforeFilter}T23:59:59.999`).getTime();
        if (Number.isFinite(modifiedBefore)) query.set("modifiedBefore", String(modifiedBefore));
      }
      const res = await fetch(`/api/fleet/${serverId}/agents/${selected}/sessions?${query.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } finally {
      setSessionsLoading(false);
    }
  }, [
    selected,
    serverId,
    sessionActiveFilter,
    sessionChannelFilter,
    sessionErrorsOnly,
    sessionLabelFilter,
    sessionModifiedAfterFilter,
    sessionModifiedBeforeFilter,
    sessionRouteDecisionOnly,
    sessionSearchFilter,
    sessionSourceFilter,
    sessionStatusFilter,
  ]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const loadSessionDetails = useCallback(async () => {
    if (!sessionId) {
      setSessionDetails(null);
      return;
    }
    setSessionDetailsLoading(true);
    try {
      const res = await fetch(
        `/api/fleet/${serverId}/agents/${selected}/sessions/${encodeURIComponent(sessionId)}?limit=24&includeSystemMessages=true`,
      );
      if (!res.ok) {
        setSessionDetails(null);
        return;
      }
      const data = await res.json();
      setSessionDetails({
        sessionId: typeof data.sessionId === "string" ? data.sessionId : sessionId,
        summary: typeof data.summary === "string" ? data.summary : undefined,
        lastModified: typeof data.lastModified === "number" ? data.lastModified : undefined,
        messages: Array.isArray(data.messages) ? data.messages as SessionMessageView[] : [],
      });
    } finally {
      setSessionDetailsLoading(false);
    }
  }, [selected, serverId, sessionId]);

  useEffect(() => {
    void loadSessionDetails();
  }, [loadSessionDetails]);

  const loadRouteDecision = useCallback(async () => {
    if (!selectedRouteDecisionId) {
      setRouteDecision(null);
      return;
    }
    setRouteDecisionLoading(true);
    try {
      const res = await fetch(
        `/api/fleet/${serverId}/routing/decisions?id=${encodeURIComponent(selectedRouteDecisionId)}&limit=1`,
      );
      if (!res.ok) {
        setRouteDecision(null);
        return;
      }
      const data = await res.json();
      setRouteDecision(Array.isArray(data) ? data[0] ?? null : null);
    } finally {
      setRouteDecisionLoading(false);
    }
  }, [selectedRouteDecisionId, serverId]);

  useEffect(() => {
    void loadRouteDecision();
  }, [loadRouteDecision]);

  const loadSubagentRuns = useCallback(async () => {
    if (!sessionId) {
      setSubagentRuns([]);
      return;
    }
    setSubagentsLoading(true);
    try {
      const res = await fetch(
        `/api/fleet/${serverId}/agents/${selected}/subagents?sessionId=${encodeURIComponent(sessionId)}&limit=12`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const runs = Array.isArray(data.runs) ? data.runs as SubagentRun[] : [];
      const enriched = await Promise.all(
        runs.map(async (run) => {
          if (run.status !== "running") return run;
          try {
            const detailRes = await fetch(
              `/api/fleet/${serverId}/agents/${selected}/subagents/${encodeURIComponent(run.runId)}`,
            );
            if (!detailRes.ok) return run;
            return await detailRes.json() as SubagentRun;
          } catch {
            return run;
          }
        }),
      );
      setSubagentRuns(enriched);
    } finally {
      setSubagentsLoading(false);
    }
  }, [selected, serverId, sessionId]);

  useEffect(() => {
    void loadSubagentRuns();
  }, [loadSubagentRuns]);

  const loadActiveRuns = useCallback(async () => {
    setActiveRunsLoading(true);
    try {
      const res = await fetch(`/api/fleet/${serverId}/agents/${selected}/runs/active`);
      if (!res.ok) return;
      const data = await res.json();
      setActiveRuns(Array.isArray(data.activeRuns) ? data.activeRuns as ActiveRunView[] : []);
    } finally {
      setActiveRunsLoading(false);
    }
  }, [selected, serverId]);

  useEffect(() => {
    void loadActiveRuns();
  }, [loadActiveRuns]);

  const loadInterrupts = useCallback(async () => {
    setInterruptsLoading(true);
    try {
      const query = new URLSearchParams({ limit: "8" });
      const runId = selectedSession?.provenance?.runId;
      if (runId) {
        query.set("runId", runId);
      } else if (sessionId) {
        query.set("targetId", sessionId);
      }
      const res = await fetch(`/api/fleet/${serverId}/agents/${selected}/interrupts?${query.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setInterrupts(Array.isArray(data.interrupts) ? data.interrupts as InterruptRecord[] : []);
    } finally {
      setInterruptsLoading(false);
    }
  }, [selected, selectedSession?.provenance?.runId, serverId, sessionId]);

  useEffect(() => {
    void loadInterrupts();
  }, [loadInterrupts]);

  const loadFileOwnership = useCallback(async () => {
    setFileOwnershipLoading(true);
    try {
      const query = new URLSearchParams({ limit: "20" });
      const sessionKey = selectedSession?.provenance?.sessionKey;
      if (sessionKey) query.set("sessionKey", sessionKey);
      const res = await fetch(`/api/fleet/${serverId}/agents/${selected}/file-ownership?${query.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setFileOwnership({
        claims: Array.isArray(data.claims) ? data.claims as FileOwnershipClaim[] : [],
        conflicts: Array.isArray(data.conflicts) ? data.conflicts as FileOwnershipConflict[] : [],
      });
    } finally {
      setFileOwnershipLoading(false);
    }
  }, [selected, selectedSession?.provenance?.sessionKey, serverId]);

  useEffect(() => {
    void loadFileOwnership();
  }, [loadFileOwnership]);

  useEffect(() => {
    if (!streaming) return;
    const id = window.setInterval(() => {
      void loadSubagentRuns();
      void loadActiveRuns();
      void loadFileOwnership();
      void loadInterrupts();
      void loadSessionDetails();
      void loadRouteDecision();
    }, 1500);
    return () => window.clearInterval(id);
  }, [loadActiveRuns, loadFileOwnership, loadInterrupts, loadRouteDecision, loadSessionDetails, loadSubagentRuns, streaming]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current && stuckToBottom.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stuckToBottom.current = atBottom;
    setShowJump(!atBottom);
  };

  const jumpToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      stuckToBottom.current = true;
      setShowJump(false);
    }
  };

  const send = async (text: string) => {
    if (!text.trim() || streaming) return;
    setPromptSuggestion(null);
    setRewindNotice(null);
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      ts: new Date(),
    };
    const agentMsgId = (Date.now() + 1).toString();
    const agentMsg: ChatMessage = {
      id: agentMsgId,
      role: "agent",
      content: "",
      toolCalls: [],
      ts: new Date(),
      streaming: true,
    };
    setMessages((m) => [...m, userMsg, agentMsg]);
    setInput("");
    setStreaming(true);
    stuckToBottom.current = true;

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(
        `/api/fleet/${serverId}/agents/${selected}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            sessionId,
            context: { channel, chatType },
          }),
          signal: abort.signal,
        },
      );

      if (!res.ok || !res.body) {
        setMessages((m) =>
          m.map((x) =>
            x.id === agentMsgId
              ? { ...x, content: "(Error: failed to get response)", streaming: false }
              : x,
          ),
        );
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;

          try {
            const ev = JSON.parse(raw);
            if (ev.type === "done") {
              if (ev.sessionId) setSessionId(ev.sessionId);
              if (ev.totalTokens) setTotalTokens((t) => t + ev.totalTokens);
              void loadSessions();
              void loadSubagentRuns();
              void loadActiveRuns();
              void loadFileOwnership();
              void loadSessionDetails();
              void loadRouteDecision();
              continue;
            }
            if (ev.type === "error") {
              setMessages((m) =>
                m.map((x) =>
                  x.id === agentMsgId
                    ? { ...x, content: x.content || `Error: ${ev.message}`, streaming: false }
                    : x,
                ),
              );
              continue;
            }
            if (ev.type === "hook_started" || ev.type === "hook_progress" || ev.type === "hook_response") {
              setHookEvents((items) => [
                {
                  id: `${Date.now()}-${items.length}`,
                  type: ev.type,
                  hookId: typeof ev.hookId === "string" ? ev.hookId : undefined,
                  hookName: typeof ev.hookName === "string" ? ev.hookName : undefined,
                  hookEvent: typeof ev.hookEvent === "string" ? ev.hookEvent : undefined,
                  output: typeof ev.output === "string" ? ev.output : undefined,
                  stdout: typeof ev.stdout === "string" ? ev.stdout : undefined,
                  stderr: typeof ev.stderr === "string" ? ev.stderr : undefined,
                  outcome: typeof ev.outcome === "string" ? ev.outcome : undefined,
                  ts: new Date(),
                },
                ...items,
              ].slice(0, 12));
              continue;
            }
            setMessages((m) =>
              m.map((x) => {
                if (x.id !== agentMsgId) return x;
                if (ev.type === "text" || ev.type === "content_block_delta" || ev.type === "partial_text") {
                  return { ...x, content: x.content + (ev.content ?? ev.text ?? ev.chunk ?? "") };
                }
                if (ev.type === "task_progress") {
                  return {
                    ...x,
                    taskProgress: ev.summary ?? ev.description ?? "Subagent is working...",
                  };
                }
                if (ev.type === "task_notification") {
                  const status = typeof ev.status === "string" ? ev.status : "completed";
                  const summary = typeof ev.summary === "string" && ev.summary.length > 0 ? ev.summary : "Task finished";
                  return {
                    ...x,
                    taskProgress: `${status}: ${summary}`,
                  };
                }
                if (ev.type === "elicitation") {
                  const serverName = typeof ev.serverName === "string" ? ev.serverName : "MCP";
                  const mode = typeof ev.mode === "string" ? ev.mode : "form";
                  const url = typeof ev.url === "string" ? ` ${ev.url}` : "";
                  const detail = typeof ev.message === "string" ? ev.message : "User input requested";
                  return {
                    ...x,
                    taskProgress: `${serverName} ${mode} elicitation: ${detail}${url}`,
                  };
                }
                if (ev.type === "tool_call" || ev.type === "tool_use") {
                  return {
                    ...x,
                    toolCalls: [
                      ...(x.toolCalls ?? []),
                      {
                        id: ev.id ?? ev.tool_call_id,
                        name: ev.name ?? ev.tool_name,
                        input: ev.input ?? {},
                        status: "running" as const,
                      },
                    ],
                  };
                }
                if (ev.type === "tool_result") {
                  return {
                    ...x,
                    toolCalls: (x.toolCalls ?? []).map((tc) =>
                      tc.id === (ev.id ?? ev.tool_call_id)
                        ? { ...tc, output: ev.output ?? ev.result, status: "done" as const }
                        : tc,
                    ),
                  };
                }
                return x;
              }),
            );
            if (ev.type === "prompt_suggestion" && typeof ev.suggestion === "string") {
              setPromptSuggestion(ev.suggestion);
            }
          } catch {
            // skip invalid json
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((m) =>
          m.map((x) =>
            x.id === agentMsgId
              ? { ...x, content: x.content || "(Error: connection lost)", streaming: false }
              : x,
          ),
        );
      }
    } finally {
      setMessages((m) =>
        m.map((x) =>
          x.id === agentMsgId ? { ...x, streaming: false } : x,
        ),
      );
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const reset = () => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setTotalTokens(0);
    setPromptSuggestion(null);
    setRewindNotice(null);
    setSessionDetails(null);
    setSubagentRuns([]);
    setActiveRuns([]);
    setHookEvents([]);
    setSessionId("sess_" + Math.random().toString(36).slice(2, 10));
    setStreaming(false);
    try { localStorage.removeItem(storageKey); } catch {}
  };

  const openSession = async (nextSessionId: string) => {
    if (!nextSessionId || streaming) return;
    const res = await fetch(
      `/api/fleet/${serverId}/agents/${selected}/sessions/${encodeURIComponent(nextSessionId)}?limit=100`,
    );
    if (!res.ok) return;

    const data = await res.json();
    const history = Array.isArray(data.messages) ? data.messages as SessionMessageView[] : [];
    setSessionId(data.sessionId ?? nextSessionId);
    setSessionDetails({
      sessionId: typeof data.sessionId === "string" ? data.sessionId : nextSessionId,
      summary: typeof data.summary === "string" ? data.summary : undefined,
      lastModified: typeof data.lastModified === "number" ? data.lastModified : undefined,
      messages: history,
    });
    setPromptSuggestion(null);
    setRewindNotice(null);
    setHookEvents([]);
    setTotalTokens(0);
    setMessages(storedEntriesToChatMessages(
      history.map((item, index) => ({
        type: item.type,
        uuid: item.uuid || `${nextSessionId}-${index}`,
        text: item.text,
        message: item.message,
      })),
    ));
  };

  const forkCurrentSession = async () => {
    if (!sessionId || streaming) return;
    const res = await fetch(`/api/fleet/${serverId}/agents/${selected}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "fork",
        sessionId,
        title: `Fork of ${sessionId.slice(0, 8)}`,
      }),
    });
    if (!res.ok) return;

    const data = await res.json();
    if (typeof data.sessionId === "string") {
      setSessionId(data.sessionId);
      setSessionDetails(null);
      setSubagentRuns([]);
      setActiveRuns([]);
      setHookEvents([]);
      setPromptSuggestion(null);
      setRewindNotice(null);
      await loadSessions();
    }
  };

  const deleteCurrentSession = async () => {
    if (!sessionId || streaming) return;
    const res = await fetch(
      `/api/fleet/${serverId}/agents/${selected}/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) return;
    reset();
    await loadSessions();
  };

  const renameCurrentSession = async () => {
    if (!sessionId || streaming) return;
    const current = selectedSession?.summary ?? selectedSession?.customTitle ?? "";
    const title = window.prompt("Session title", current);
    if (title === null) return;

    const res = await fetch(
      `/api/fleet/${serverId}/agents/${selected}/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
    );
    if (!res.ok) return;

    const data = await res.json();
    const savedTitle = typeof data.title === "string" ? data.title : title.trim();
    setSessions((items) => items.map((item) => (
      item.sessionId === (data.sessionId ?? sessionId)
        ? { ...item, summary: savedTitle, customTitle: savedTitle }
        : item
    )));
    await loadSessions();
  };

  const updateCurrentSessionLabels = async () => {
    if (!sessionId || streaming) return;
    const current = selectedSession?.labels ?? [];
    const next = window.prompt("Session labels, comma-separated", current.join(", "));
    if (next === null) return;

    const labels = next
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    const res = await fetch(
      `/api/fleet/${serverId}/agents/${selected}/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels }),
      },
    );
    if (!res.ok) return;

    const data = await res.json();
    const savedLabels = Array.isArray(data.labels)
      ? data.labels.filter((label: unknown): label is string => typeof label === "string")
      : labels;
    setSessions((items) => items.map((item) => (
      item.sessionId === (data.sessionId ?? sessionId)
        ? { ...item, labels: savedLabels }
        : item
    )));
    await loadSessions();
  };

  const clearSessionFilters = () => {
    setSessionSearchFilter("");
    setSessionLabelFilter("");
    setSessionSourceFilter("all");
    setSessionStatusFilter("all");
    setSessionActiveFilter("all");
    setSessionChannelFilter("");
    setSessionErrorsOnly(false);
    setSessionRouteDecisionOnly(false);
    setSessionModifiedAfterFilter("");
    setSessionModifiedBeforeFilter("");
    setShowSessionFilters(false);
  };

  const interruptSubagentRun = async (runId: string) => {
    const res = await fetch(
      `/api/fleet/${serverId}/agents/${selected}/subagents/${encodeURIComponent(runId)}`,
      { method: "POST" },
    );
    if (res.ok || res.status === 409) {
      await loadSubagentRuns();
    }
  };

  const mutateFileOwnershipClaim = async (claimId: string, action: "release" | "override") => {
    const res = await fetch(`/api/fleet/${serverId}/agents/${selected}/file-ownership`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimId, action }),
    });
    if (res.ok || res.status === 404) {
      await loadFileOwnership();
    }
  };

  const stopCurrentRun = async () => {
    const active = activeRuns.find((run) => run.runId);
    if (active?.runId) {
      await fetch(
        `/api/fleet/${serverId}/agents/${selected}/runs/${encodeURIComponent(active.runId)}/interrupt`,
        { method: "POST" },
      ).catch(() => {});
      void loadActiveRuns();
      void loadInterrupts();
    }
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setStreaming(false);
  };

  const rewindCurrentSession = async () => {
    if (!sessionId || streaming) return;
    setRewindNotice("Checking file checkpoints...");

    const endpoint = `/api/fleet/${serverId}/agents/${selected}/sessions/${encodeURIComponent(sessionId)}/rewind`;
    const previewRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    if (!previewRes.ok) {
      setRewindNotice("Rewind preview failed.");
      return;
    }

    const preview = await previewRes.json() as RewindResult;
    if (!preview.canRewind) {
      setRewindNotice(preview.error ?? "No rewindable file checkpoints for this session.");
      return;
    }

    const files = preview.filesChanged ?? [];
    const stats = `${files.length} file${files.length === 1 ? "" : "s"}, +${preview.insertions ?? 0}/-${preview.deletions ?? 0}`;
    const confirmed = window.confirm(
      `Rewind file changes for this session?\n\n${stats}\n${files.slice(0, 8).join("\n")}${files.length > 8 ? "\n..." : ""}`,
    );
    if (!confirmed) {
      setRewindNotice(`Rewind preview: ${stats}.`);
      return;
    }

    const applyRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: false,
        confirm: true,
        userMessageId: preview.userMessageId,
      }),
    });
    const applied = await applyRes.json() as RewindResult;
    if (!applied.canRewind) {
      setRewindNotice(applied.error ?? "Rewind failed.");
      return;
    }

    setRewindNotice(`Rewound ${applied.filesChanged?.length ?? 0} file${(applied.filesChanged?.length ?? 0) === 1 ? "" : "s"}.`);
  };

  const suggested = [
    "What alerts came in overnight?",
    "Summarize the last incident",
    "What tools do you have?",
    "List your skills",
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--oc-border)] bg-[var(--oc-bg0)]/95 px-4 py-3 md:px-5">
        <div className="grid gap-3 2xl:grid-cols-[minmax(220px,1fr)_minmax(640px,auto)] 2xl:items-start">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-[var(--color-foreground)]">
              Chat
            </h1>
            <p className="mt-0.5 text-[11.5px] text-[var(--oc-text-muted)]">
              Live test conversation with any agent through the Gateway.
            </p>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
              {agent && (
                <span className="inline-flex max-w-full items-center rounded border border-[var(--oc-accent-ring)] bg-[var(--oc-accent-soft)] px-1.5 py-px text-[10px] font-medium text-[var(--oc-accent)]">
                  <span className="truncate">{agent.model ?? "---"}</span>
                </span>
              )}
              <span className="inline-flex max-w-full items-center rounded border border-[var(--oc-border)] bg-white/[0.03] px-1.5 py-px font-mono text-[10px] font-medium text-[var(--oc-text-muted)]">
                <span className="truncate">session {sessionId.slice(0, 12)}...</span>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 2xl:items-end">
            <div className="flex w-full flex-wrap items-center gap-2 2xl:justify-end">
              <ToolbarSelect
                aria-label="Agent"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  reset();
                }}
                className="w-full sm:w-[224px]"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id}
                  </option>
                ))}
              </ToolbarSelect>

              <ToolbarSelect
                aria-label="Open session"
                value=""
                onChange={(e) => {
                  const next = e.target.value;
                  e.currentTarget.value = "";
                  void openSession(next);
                }}
                disabled={streaming || sessionsLoading}
                className="w-full sm:w-[310px]"
              >
                <option value="">
                  {sessionsLoading ? "loading sessions..." : `sessions (${sessions.length})`}
                </option>
                {sessions.map((session) => (
                  <option key={session.sessionId} value={session.sessionId}>
                    {session.tag ? `[${session.tag}] ` : ""}
                    {session.provenance ? `${session.provenance.source}/${session.provenance.channel} - ` : ""}
                    {session.provenance?.routeOutcome ? `${session.provenance.routeOutcome} - ` : ""}
                    {session.labels?.length ? `#${session.labels.join(" #")} - ` : ""}
                    {session.customTitle || session.summary || session.sessionId}
                  </option>
                ))}
              </ToolbarSelect>

              <ToolbarSelect
                aria-label="Channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="w-[116px]"
              >
                <option value="web">web</option>
                <option value="telegram">telegram</option>
                <option value="whatsapp">whatsapp</option>
              </ToolbarSelect>

              <ToolbarSelect
                aria-label="Chat type"
                value={chatType}
                onChange={(e) => setChatType(e.target.value)}
                className="w-[90px]"
              >
                <option value="dm">dm</option>
                <option value="group">group</option>
              </ToolbarSelect>

              <Button
                variant="outline"
                size="sm"
                onClick={reset}
                className="h-8 shrink-0 border-[var(--oc-accent-ring)] bg-[var(--oc-accent-soft)] px-3 text-xs text-[var(--color-foreground)] transition-transform hover:bg-[var(--oc-accent-soft)] active:translate-y-px"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                New session
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-[var(--oc-border)] bg-[var(--oc-bg1)]/70 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 items-center gap-2 pr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--oc-text-muted)]">
              <History className="h-3.5 w-3.5" />
              Sessions
            </div>

            <ToolbarTextInput
              aria-label="Search sessions"
              value={sessionSearchFilter}
              onChange={(e) => setSessionSearchFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadSessions();
              }}
              placeholder="search sessions"
              icon={<Search className="h-3.5 w-3.5" />}
              className="w-full sm:min-w-[190px] sm:flex-1 sm:max-w-[280px]"
            />

            <ToolbarTextInput
              aria-label="Filter by label"
              value={sessionLabelFilter}
              onChange={(e) => setSessionLabelFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadSessions();
              }}
              placeholder="label"
              icon={<Tags className="h-3.5 w-3.5" />}
              className="w-full sm:w-[150px]"
            />

            <Button
              variant="outline"
              size="sm"
              onClick={loadSessions}
              disabled={sessionsLoading}
              className="h-8 px-3 text-xs transition-transform active:translate-y-px"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", sessionsLoading && "animate-spin")} />
              Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSessionFilters((open) => !open)}
              aria-expanded={sessionFiltersOpen}
              className={cn(
                "h-8 px-3 text-xs transition-transform active:translate-y-px",
                activeSessionFilterCount > 0 && "border-[var(--oc-accent-ring)] text-[var(--oc-accent)]",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters{activeSessionFilterCount > 0 ? ` ${activeSessionFilterCount}` : ""}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={clearSessionFilters}
              disabled={sessionsLoading || activeSessionFilterCount === 0}
              className="h-8 px-3 text-xs transition-transform active:translate-y-px"
            >
              Clear
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={streaming || !sessionId}
                  className="ml-0 h-8 px-3 text-xs transition-transform active:translate-y-px sm:ml-auto"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  Session
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-44 border-[var(--oc-border)] bg-[var(--oc-bg2)] text-[var(--color-foreground)]"
              >
                <DropdownMenuLabel className="px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--oc-text-muted)]">
                  Current session
                </DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={streaming || !sessionId}
                  onSelect={() => {
                    void renameCurrentSession();
                  }}
                  className="text-xs"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={streaming || !sessionId}
                  onSelect={() => {
                    void updateCurrentSessionLabels();
                  }}
                  className="text-xs"
                >
                  <Tags className="h-3.5 w-3.5" />
                  Labels
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={streaming || !sessionId}
                  onSelect={() => {
                    void forkCurrentSession();
                  }}
                  className="text-xs"
                >
                  <GitFork className="h-3.5 w-3.5" />
                  Fork
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={streaming || !sessionId}
                  onSelect={() => {
                    void rewindCurrentSession();
                  }}
                  className="text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Rewind
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[var(--oc-border)]" />
                <DropdownMenuItem
                  disabled={streaming || !sessionId}
                  onSelect={() => {
                    void deleteCurrentSession();
                  }}
                  className="text-xs text-[var(--oc-red)] focus:text-[var(--oc-red)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {sessionFiltersOpen && (
            <div className="mt-2 grid grid-cols-1 gap-2 border-t border-[var(--oc-border)] pt-2 sm:grid-cols-2 lg:grid-cols-[repeat(6,minmax(0,1fr))]">
              <ToolbarSelect
                aria-label="Session source"
                value={sessionSourceFilter}
                onChange={(e) => setSessionSourceFilter(e.target.value as typeof sessionSourceFilter)}
              >
                <option value="all">source: all</option>
                <option value="web">source: web</option>
                <option value="channel">source: channel</option>
                <option value="cron">source: cron</option>
              </ToolbarSelect>

              <ToolbarSelect
                aria-label="Session status"
                value={sessionStatusFilter}
                onChange={(e) => setSessionStatusFilter(e.target.value as typeof sessionStatusFilter)}
              >
                <option value="all">status: all</option>
                <option value="running">running</option>
                <option value="succeeded">succeeded</option>
                <option value="failed">failed</option>
                <option value="interrupted">interrupted</option>
              </ToolbarSelect>

              <ToolbarSelect
                aria-label="Session activity"
                value={sessionActiveFilter}
                onChange={(e) => setSessionActiveFilter(e.target.value as typeof sessionActiveFilter)}
              >
                <option value="all">activity: all</option>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </ToolbarSelect>

              <ToolbarTextInput
                aria-label="Filter by channel"
                value={sessionChannelFilter}
                onChange={(e) => setSessionChannelFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadSessions();
                }}
                placeholder="channel"
              />

              <ToolbarTextInput
                aria-label="Modified after"
                type="date"
                value={sessionModifiedAfterFilter}
                onChange={(e) => setSessionModifiedAfterFilter(e.target.value)}
                title="Modified after"
              />

              <ToolbarTextInput
                aria-label="Modified before"
                type="date"
                value={sessionModifiedBeforeFilter}
                onChange={(e) => setSessionModifiedBeforeFilter(e.target.value)}
                title="Modified before"
              />

              <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-6">
                <ToolbarCheckbox
                  checked={sessionErrorsOnly}
                  onChange={setSessionErrorsOnly}
                >
                  errors only
                </ToolbarCheckbox>
                <ToolbarCheckbox
                  checked={sessionRouteDecisionOnly}
                  onChange={setSessionRouteDecisionOnly}
                >
                  routed only
                </ToolbarCheckbox>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedSession && (
        <div
          className="border-b px-5 py-2"
          style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
        >
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className="max-w-[240px] truncate text-[12px] font-medium"
              style={{ color: "var(--color-foreground)" }}
              title={selectedSession.customTitle || selectedSession.summary || selectedSession.sessionId}
            >
              {selectedSession.customTitle || selectedSession.summary || selectedSession.sessionId}
            </span>
            {selectedSession.provenance && (
              <>
                <SubagentPill tone={selectedSession.provenance.status === "failed" ? "error" : selectedSession.provenance.status === "running" ? "running" : "done"}>
                  {selectedSession.provenance.status}
                </SubagentPill>
                <SubagentPill>
                  {selectedSession.provenance.source}/{selectedSession.provenance.channel}
                </SubagentPill>
              </>
            )}
            <SubagentPill>{selectedSession.messageCount ?? 0} msgs</SubagentPill>
            {selectedSession.lastModified && (
              <SubagentPill title={String(selectedSession.lastModified)}>
                {formatTime(selectedSession.lastModified)}
              </SubagentPill>
            )}
            {selectedSession.lastMessage?.text && (
              <span className="min-w-[160px] flex-1 truncate" style={{ color: "var(--oc-text-muted)" }}>
                {selectedSession.lastMessage.text}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex min-w-0 flex-1 justify-center overflow-auto"
        >
          <div className={`flex w-full max-w-[720px] flex-col gap-4 p-5 ${messages.length === 0 ? "flex-1" : ""}`}>
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3.5">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ background: "var(--oc-accent-soft)", color: "var(--oc-accent)" }}
                >
                  <Bot className="h-6 w-6" />
                </div>
                <div className="text-center">
                  <p className="mb-1 text-[15px]" style={{ color: "var(--color-foreground)" }}>
                    Send a message to start testing{" "}
                    <span style={{ fontFamily: "var(--oc-mono)", color: "var(--oc-accent)" }}>
                      {selected}
                    </span>
                  </p>
                  <p className="text-xs" style={{ color: "var(--oc-text-muted)" }}>
                    Context: channel={channel} &middot; chat_type={chatType}
                  </p>
                </div>
                <div className="flex max-w-[560px] flex-wrap justify-center gap-1.5">
                  {suggested.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="cursor-pointer rounded-2xl border px-3 py-1.5 text-xs"
                      style={{
                        background: "var(--oc-bg2)",
                        borderColor: "var(--oc-border)",
                        color: "var(--oc-text-dim)",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m) => {
                  if (m.role === "agent" && m.streaming && !m.content && !m.taskProgress && !(m.toolCalls?.length)) return null;
                  return <MessageBubble key={m.id} m={m} />;
                })}
                {streaming && !messages.some((m) => m.streaming && (m.content || m.taskProgress || (m.toolCalls?.length ?? 0) > 0)) && (
                  <div className="flex gap-2.5">
                    <div
                      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: "linear-gradient(135deg, var(--oc-accent), #c084fc)",
                      }}
                    >
                      <Bot className="h-[13px] w-[13px]" style={{ color: "#0b0d12" }} />
                    </div>
                    <div className="flex items-center gap-1.5 py-1">
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--oc-accent)", animation: "pulse 1.2s ease-in-out infinite" }}
                      />
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--oc-accent)", animation: "pulse 1.2s ease-in-out 0.2s infinite" }}
                      />
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--oc-accent)", animation: "pulse 1.2s ease-in-out 0.4s infinite" }}
                      />
                      <span className="ml-1 text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
                        Thinking...
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <SubagentRunsPanel
          serverId={serverId}
          selectedSession={selectedSession}
          session={sessionDetails}
          sessionLoading={sessionDetailsLoading}
          routeDecision={routeDecision}
          routeDecisionLoading={routeDecisionLoading}
          hookEvents={hookEvents}
          runs={subagentRuns}
          activeRuns={activeRuns}
          interrupts={interrupts}
          fileOwnership={fileOwnership}
          loading={subagentsLoading}
          activeRunsLoading={activeRunsLoading}
          interruptsLoading={interruptsLoading}
          fileOwnershipLoading={fileOwnershipLoading}
          onRefresh={() => {
            void loadSessionDetails();
            void loadRouteDecision();
            void loadSubagentRuns();
            void loadActiveRuns();
            void loadInterrupts();
            void loadFileOwnership();
          }}
          onInterrupt={interruptSubagentRun}
          onMutateFileOwnership={mutateFileOwnershipClaim}
        />
      </div>

      {/* Jump to bottom */}
      {showJump && (
        <div className="absolute bottom-24 left-1/2 z-10 -translate-x-1/2">
          <button
            onClick={jumpToBottom}
            className="flex items-center gap-1 rounded-full border px-3 py-1 text-[11px]"
            style={{
              background: "var(--oc-bg2)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            <ArrowDown className="h-3 w-3" />
            Jump to bottom
          </button>
        </div>
      )}

      {/* Input */}
      <div
        className="flex justify-center px-5 pb-4 pt-1"
      >
        <div className="flex w-full max-w-[720px] flex-col gap-2">
          {rewindNotice && (
            <div
              className="w-fit max-w-full rounded-full border px-3 py-1.5 text-[11.5px]"
              style={{
                background: "var(--oc-bg2)",
                borderColor: "var(--oc-border)",
                color: "var(--oc-text-muted)",
              }}
            >
              {rewindNotice}
            </div>
          )}
          {promptSuggestion && !streaming && (
            <button
              type="button"
              onClick={() => setInput(promptSuggestion)}
              className="flex w-fit max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-left text-[11.5px]"
              style={{
                background: "var(--oc-bg2)",
                borderColor: "var(--oc-accent-ring)",
                color: "var(--oc-text-dim)",
              }}
            >
              <Zap className="h-3 w-3 shrink-0" style={{ color: "var(--oc-accent)" }} />
              <span className="shrink-0" style={{ color: "var(--oc-accent)" }}>
                Suggested next
              </span>
              <span className="truncate">{promptSuggestion}</span>
            </button>
          )}
          <div
            className="flex items-end gap-2 rounded-lg border p-2"
            style={{
              background: "var(--oc-bg2)",
              borderColor: "var(--oc-border)",
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Type a message. Enter to send, Shift+Enter for newline."
              disabled={streaming}
              rows={1}
              className="max-h-[120px] min-h-[26px] flex-1 resize-none border-none bg-transparent p-1.5 text-[13px] leading-5 outline-none"
              style={{ color: "var(--color-foreground)" }}
            />
            <Button
              size="sm"
              disabled={!streaming && !input.trim()}
              onClick={() => {
                if (streaming) {
                  void stopCurrentRun();
                } else {
                  send(input);
                }
              }}
            >
              {streaming ? (
                <>
                  <Pause className="h-3.5 w-3.5" />
                  Stop
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Send
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Subagent Runs Panel                                                */
/* ------------------------------------------------------------------ */

function SubagentRunsPanel({
  serverId,
  selectedSession,
  session,
  sessionLoading,
  routeDecision,
  routeDecisionLoading,
  hookEvents,
  runs,
  activeRuns,
  interrupts,
  fileOwnership,
  loading,
  activeRunsLoading,
  interruptsLoading,
  fileOwnershipLoading,
  onRefresh,
  onInterrupt,
  onMutateFileOwnership,
}: {
  serverId: string;
  selectedSession?: AgentSession;
  session: SessionDetails | null;
  sessionLoading: boolean;
  routeDecision: RouteDecision | null;
  routeDecisionLoading: boolean;
  hookEvents: HookEventView[];
  runs: SubagentRun[];
  activeRuns: ActiveRunView[];
  interrupts: InterruptRecord[];
  fileOwnership: FileOwnershipView;
  loading: boolean;
  activeRunsLoading: boolean;
  interruptsLoading: boolean;
  fileOwnershipLoading: boolean;
  onRefresh: () => void | Promise<void>;
  onInterrupt: (runId: string) => void | Promise<void>;
  onMutateFileOwnership: (claimId: string, action: "release" | "override") => void | Promise<void>;
}) {
  const running = runs.filter((run) => run.status === "running").length;
  const activeTaskCount = activeRuns.reduce((sum, run) => sum + run.activeTaskIds.length, 0);

  return (
    <aside
      className="hidden w-[320px] shrink-0 flex-col border-l xl:flex"
      style={{
        background: "var(--oc-bg1)",
        borderColor: "var(--oc-border)",
      }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--oc-border)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--oc-accent)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--color-foreground)" }}>
            Debug rail
          </span>
          <span
            className="rounded-full border px-1.5 py-px text-[10px]"
            style={{
              borderColor: "var(--oc-border)",
              color: running > 0 ? "var(--oc-yellow)" : "var(--oc-text-muted)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {running} running
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void onRefresh()}
          disabled={loading || sessionLoading}
          className="h-7 px-2"
          title="Refresh session and subagent runtime data"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading || sessionLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
        <SessionDebugCard
          session={session}
          loading={sessionLoading}
          labels={selectedSession?.labels ?? []}
        />
        <ActiveRunsCard
          serverId={serverId}
          runs={activeRuns}
          loading={activeRunsLoading}
          activeTaskCount={activeTaskCount}
        />
        <InterruptsCard interrupts={interrupts} loading={interruptsLoading} />
        <FileOwnershipCard
          view={fileOwnership}
          loading={fileOwnershipLoading}
          onMutate={onMutateFileOwnership}
        />
        <RouteDecisionCard
          serverId={serverId}
          selectedSession={selectedSession}
          decision={routeDecision}
          loading={routeDecisionLoading}
        />
        <HookEventsCard events={hookEvents} />
        {runs.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center rounded-lg border px-4 py-6 text-center"
            style={{
              background: "var(--oc-bg2)",
              borderColor: "var(--oc-border)",
              color: "var(--oc-text-muted)",
            }}
          >
            <Workflow className="mb-2 h-5 w-5" style={{ color: "var(--oc-text-muted)" }} />
            <p className="text-xs" style={{ color: "var(--color-foreground)" }}>
              No subagent runs for this session.
            </p>
            <p className="mt-1 text-[11px] leading-relaxed">
              Runs appear here when Claude Agent SDK emits subagent activity.
            </p>
          </div>
        ) : (
          runs.map((run) => (
            <SubagentRunCard
              key={run.runId}
              run={run}
              onInterrupt={onInterrupt}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function ActiveRunsCard({
  serverId,
  runs,
  loading,
  activeTaskCount,
}: {
  serverId: string;
  runs: ActiveRunView[];
  loading: boolean;
  activeTaskCount: number;
}) {
  return (
    <section
      className="rounded-lg border p-2.5"
      style={{
        background: "var(--oc-bg2)",
        borderColor: runs.length > 0 ? "var(--oc-accent-ring)" : "var(--oc-border)",
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--oc-accent)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--color-foreground)" }}>
            Active SDK runs
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SubagentPill tone={loading ? "running" : runs.length > 0 ? "running" : "default"}>
            {loading ? "loading" : `${runs.length} runs`}
          </SubagentPill>
          {activeTaskCount > 0 && <SubagentPill tone="running">{activeTaskCount} tasks</SubagentPill>}
        </div>
      </div>

      {runs.length === 0 ? (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
          No active SDK run is registered for this agent.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {runs.slice(0, 4).map((run) => {
            const idleMs = Date.now() - run.lastActivityAt;
            return (
              <div
                key={run.runId ?? run.sessionKey}
                className="rounded border px-2 py-1.5"
                style={{
                  background: "var(--oc-bg1)",
                  borderColor: "var(--oc-border)",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="truncate text-[10.5px]"
                      style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                      title={run.runId ?? run.sessionKey}
                    >
                      {shortId(run.runId ?? run.sessionKey, 16)}
                    </span>
                    {run.runId && <RunDiagnosticsLink serverId={serverId} runId={run.runId} />}
                  </div>
                  <SubagentPill tone="running">{run.lastEventType}</SubagentPill>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1.5 text-[10.5px]">
                  <SubagentMeta label="idle" value={formatDuration(idleMs)} />
                  <SubagentMeta label="registered" value={formatTime(run.registeredAt)} />
                  {run.sdkSessionId && (
                    <SubagentMeta label="sdk" value={shortId(run.sdkSessionId, 12)} title={run.sdkSessionId} />
                  )}
                  {run.channelDeliveryTarget && (
                    <SubagentMeta
                      label="channel"
                      value={run.channelDeliveryTarget.channel}
                      title={run.channelDeliveryTarget.peerId}
                    />
                  )}
                </div>
                {run.activeTaskIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {run.activeTaskIds.slice(0, 4).map((taskId) => (
                      <SubagentPill key={taskId} tone="running" title={taskId}>
                        {shortId(taskId, 12)}
                      </SubagentPill>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function InterruptsCard({
  interrupts,
  loading,
}: {
  interrupts: InterruptRecord[];
  loading: boolean;
}) {
  return (
    <section
      className="rounded-lg border p-2.5"
      style={{
        background: "var(--oc-bg2)",
        borderColor: interrupts.some((item) => item.result === "failed") ? "var(--oc-red)" : "var(--oc-border)",
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Pause className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--oc-accent)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--color-foreground)" }}>
            Interrupt requests
          </span>
        </div>
        <SubagentPill tone={loading ? "running" : interrupts.length > 0 ? "running" : "default"}>
          {loading ? "loading" : `${interrupts.length} recent`}
        </SubagentPill>
      </div>

      {interrupts.length === 0 ? (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
          No interrupt request is recorded for this selected run.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {interrupts.slice(0, 5).map((item) => (
            <div
              key={`${item.id ?? item.timestamp}:${item.targetId}`}
              className="rounded border px-2 py-1.5"
              style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="truncate text-[10.5px]"
                  style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  title={item.targetId}
                >
                  {shortId(item.targetId, 18)}
                </span>
                <SubagentPill tone={item.result === "interrupted" ? "done" : "error"}>
                  {item.result}
                </SubagentPill>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1.5 text-[10.5px]">
                <SubagentMeta label="by" value={item.requestedBy ?? "unknown"} />
                <SubagentMeta label="time" value={item.timestamp ? formatTime(item.timestamp) : "unknown"} />
                {item.runId && <SubagentMeta label="run" value={shortId(item.runId, 10)} title={item.runId} />}
                {item.sdkSessionId && (
                  <SubagentMeta label="sdk" value={shortId(item.sdkSessionId, 10)} title={item.sdkSessionId} />
                )}
              </div>
              {item.reason && (
                <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
                  {item.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FileOwnershipCard({
  view,
  loading,
  onMutate,
}: {
  view: FileOwnershipView;
  loading: boolean;
  onMutate: (claimId: string, action: "release" | "override") => void | Promise<void>;
}) {
  const conflicts = view.conflicts;
  const claims = view.claims;

  return (
    <section
      className="rounded-lg border p-2.5"
      style={{
        background: "var(--oc-bg2)",
        borderColor: conflicts.length > 0 ? "rgba(250,204,21,0.35)" : "var(--oc-border)",
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--oc-accent)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--color-foreground)" }}>
            File ownership
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SubagentPill tone={conflicts.length > 0 ? "running" : "default"}>
            {loading ? "loading" : `${claims.length} claims`}
          </SubagentPill>
          {conflicts.length > 0 && <SubagentPill tone="running">{conflicts.length} conflicts</SubagentPill>}
        </div>
      </div>

      {claims.length === 0 && conflicts.length === 0 ? (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
          No active file claims or subagent write conflicts for this agent.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {conflicts.slice(0, 3).map((conflict) => (
            <div
              key={conflict.conflictId}
              className="rounded border px-2 py-1.5"
              style={{ background: "var(--oc-bg1)", borderColor: "rgba(250,204,21,0.28)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div
                    className="truncate text-[10.5px]"
                    style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                    title={conflict.path}
                  >
                    {shortId(conflict.path, 28)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <SubagentPill tone={conflict.action === "deny" ? "running" : "default"}>
                      {conflict.action}
                    </SubagentPill>
                    <SubagentPill title={conflict.requested.subagentId}>
                      req {shortId(conflict.requested.subagentId, 10)}
                    </SubagentPill>
                    <SubagentPill title={conflict.existing.subagentId}>
                      owner {shortId(conflict.existing.subagentId, 10)}
                    </SubagentPill>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-[11px]"
                  onClick={() => void onMutate(conflict.existing.claimId, "override")}
                  title="Release the existing owner claim so the requesting subagent can retry."
                >
                  Override
                </Button>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
                {conflict.reason}
              </p>
            </div>
          ))}

          {claims.slice(0, 4).map((claim) => (
            <div
              key={claim.claimId}
              className="rounded border px-2 py-1.5"
              style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div
                    className="truncate text-[10.5px]"
                    style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                    title={claim.path}
                  >
                    {shortId(claim.path, 28)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <SubagentPill tone={claim.mode === "write" ? "running" : "default"}>
                      {claim.mode}
                    </SubagentPill>
                    <SubagentPill title={claim.subagentId}>{shortId(claim.subagentId, 12)}</SubagentPill>
                    <SubagentPill title={claim.runId}>{shortId(claim.runId, 10)}</SubagentPill>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-[11px]"
                  onClick={() => void onMutate(claim.claimId, "release")}
                  title="Release this active file ownership claim."
                >
                  Release
                </Button>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[10.5px]">
                <SubagentMeta label="claimed" value={formatTime(claim.claimedAt)} />
                <SubagentMeta label="expires" value={formatTime(claim.expiresAt)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SessionDebugCard({
  session,
  loading,
  labels,
}: {
  session: SessionDetails | null;
  loading: boolean;
  labels: string[];
}) {
  const messages = session?.messages ?? [];
  const userMessages = messages.filter((message) => message.type === "user").length;
  const assistantMessages = messages.filter((message) => message.type === "assistant").length;
  const systemMessages = messages.filter((message) => message.type === "system").length;
  const last = messages.at(-1);

  return (
    <section
      className="rounded-lg border p-2.5"
      style={{
        background: "var(--oc-bg2)",
        borderColor: "var(--oc-border)",
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--oc-accent)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--color-foreground)" }}>
            Session
          </span>
        </div>
        <SubagentPill tone={loading ? "running" : "default"}>{loading ? "loading" : `${messages.length} msgs`}</SubagentPill>
      </div>

      {session ? (
        <>
          <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
            <SubagentMeta label="id" value={shortId(session.sessionId, 14)} title={session.sessionId} />
            <SubagentMeta
              label="modified"
              value={session.lastModified ? formatTime(session.lastModified) : "unknown"}
            />
            <SubagentMeta label="user" value={String(userMessages)} />
            <SubagentMeta label="assistant" value={String(assistantMessages)} />
            {systemMessages > 0 && <SubagentMeta label="system" value={String(systemMessages)} />}
          </div>

          {session.summary && (
            <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed" style={{ color: "var(--oc-text-dim)" }}>
              {session.summary}
            </p>
          )}

          {labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {labels.slice(0, 6).map((label) => (
                <SubagentPill key={label} title={label}>
                  #{label}
                </SubagentPill>
              ))}
            </div>
          )}

          {last && (
            <div
              className="mt-2 rounded border px-2 py-1.5"
              style={{
                background: "var(--oc-bg1)",
                borderColor: "var(--oc-border)",
              }}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.5px]" style={{ color: "var(--oc-text-muted)" }}>
                  last {last.type}
                </span>
                {last.uuid && <SubagentPill title={last.uuid}>{shortId(last.uuid, 10)}</SubagentPill>}
              </div>
              <p className="line-clamp-3 text-[11px] leading-relaxed" style={{ color: "var(--oc-text-dim)" }}>
                {last.text || JSON.stringify(last.message ?? "")}
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
          No SDK transcript loaded yet. It will appear after the session is persisted by Claude Agent SDK.
        </p>
      )}
    </section>
  );
}

function RouteDecisionCard({
  serverId,
  selectedSession,
  decision,
  loading,
}: {
  serverId: string;
  selectedSession?: AgentSession;
  decision: RouteDecision | null;
  loading: boolean;
}) {
  const provenance = selectedSession?.provenance;
  const candidates = decision?.candidates ?? [];

  return (
    <section
      className="rounded-lg border p-2.5"
      style={{
        background: "var(--oc-bg2)",
        borderColor: "var(--oc-border)",
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--oc-accent)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--color-foreground)" }}>
            Route decision
          </span>
        </div>
        <SubagentPill tone={loading ? "running" : decision ? "done" : "default"}>
          {loading ? "loading" : decision?.outcome ?? "none"}
        </SubagentPill>
      </div>

      {provenance ? (
        <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
          <div className="flex min-w-0 items-end gap-1.5">
            <div className="min-w-0 flex-1">
              <SubagentMeta label="run" value={shortId(provenance.runId, 12)} title={provenance.runId} />
            </div>
            <RunDiagnosticsLink serverId={serverId} runId={provenance.runId} />
          </div>
          <SubagentMeta label="status" value={provenance.status} />
          <SubagentMeta label="source" value={`${provenance.source}/${provenance.channel}`} />
          <SubagentMeta label="started" value={formatTime(provenance.startedAt)} />
          {provenance.routeDecisionId && (
            <SubagentMeta
              label="decision"
              value={shortId(provenance.routeDecisionId, 12)}
              title={provenance.routeDecisionId}
            />
          )}
          <SubagentMeta label="session key" value={shortId(provenance.sessionKey, 18)} title={provenance.sessionKey} />
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
          No run provenance is attached to this SDK session yet.
        </p>
      )}

      {decision && (
        <>
          <div
            className="mt-2 rounded border px-2 py-1.5"
            style={{
              background: "var(--oc-bg1)",
              borderColor: "var(--oc-border)",
            }}
          >
            <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
              <SubagentMeta label="winner" value={decision.winnerAgentId ?? "none"} />
              <SubagentMeta label="access" value={decision.accessAllowed === undefined ? "unknown" : decision.accessAllowed ? "allowed" : "denied"} />
              <SubagentMeta label="chat" value={`${decision.channel}/${decision.chatType}`} />
              <SubagentMeta label="peer" value={shortId(decision.peerId, 14)} title={decision.peerId} />
              {decision.queueAction && <SubagentMeta label="queue" value={decision.queueAction} />}
              {decision.messageId && <SubagentMeta label="message" value={shortId(decision.messageId, 12)} title={decision.messageId} />}
            </div>
            {decision.accessReason && (
              <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed" style={{ color: "var(--oc-text-dim)" }}>
                {decision.accessReason}
              </p>
            )}
          </div>

          {candidates.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {candidates.slice(0, 3).map((candidate) => (
                <div
                  key={`${candidate.agentId}-${candidate.priority}-${candidate.scope}`}
                  className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                  style={{
                    background: "var(--oc-bg1)",
                    borderColor: "var(--oc-border)",
                  }}
                >
                  <span
                    className="truncate text-[10.5px]"
                    title={candidate.agentId}
                    style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  >
                    {candidate.agentId}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {candidate.mentionOnly && <SubagentPill>mention</SubagentPill>}
                    <SubagentPill>{candidate.scope}</SubagentPill>
                    <SubagentPill>p{candidate.priority}</SubagentPill>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function HookEventsCard({ events }: { events: HookEventView[] }) {
  return (
    <section
      className="rounded-lg border p-2.5"
      style={{
        background: "var(--oc-bg2)",
        borderColor: "var(--oc-border)",
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--oc-accent)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--color-foreground)" }}>
            SDK hooks
          </span>
        </div>
        <SubagentPill>{events.length}</SubagentPill>
      </div>

      {events.length === 0 ? (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
          Hook lifecycle events will appear here while the SDK stream is active.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {events.slice(0, 5).map((event) => {
            const detail = event.stderr || event.stdout || event.output || event.outcome || "";
            return (
              <div
                key={event.id}
                className="rounded border px-2 py-1.5"
                style={{
                  background: "var(--oc-bg1)",
                  borderColor: "var(--oc-border)",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="truncate text-[10.5px]"
                    style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                    title={event.hookName ?? event.hookId}
                  >
                    {event.hookName || event.hookId || event.type}
                  </span>
                  <SubagentPill tone={event.type === "hook_response" ? "done" : "running"}>
                    {event.type.replace("hook_", "")}
                  </SubagentPill>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="truncate text-[10px]" style={{ color: "var(--oc-text-muted)" }}>
                    {event.hookEvent || "hook"}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
                    {event.ts.toLocaleTimeString()}
                  </span>
                </div>
                {detail && (
                  <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed" style={{ color: "var(--oc-text-dim)" }}>
                    {detail}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SubagentRunCard({
  run,
  onInterrupt,
}: {
  run: SubagentRun;
  onInterrupt: (runId: string) => void | Promise<void>;
}) {
  const isRunning = run.status === "running";
  const elapsedMs = (run.finishedAt ?? Date.now()) - run.startedAt;
  const canInterrupt = Boolean(run.interruptSupported && isRunning);
  const observedTools = run.toolSummary
    ? run.toolSummary.started + run.toolSummary.completed + run.toolSummary.failed
    : 0;

  return (
    <div
      className="rounded-lg border p-2.5"
      style={{
        background: "var(--oc-bg2)",
        borderColor: isRunning ? "var(--oc-accent-ring)" : "var(--oc-border)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background: isRunning ? "var(--oc-yellow)" : "var(--oc-green)",
                animation: isRunning ? "pulse 1s infinite" : undefined,
              }}
            />
            <span
              className="truncate text-[12px] font-medium"
              style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
              title={run.subagentId}
            >
              {shortId(run.subagentId, 18)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <SubagentPill>{run.subagentType ?? "subagent"}</SubagentPill>
            {run.policy && (
              <>
                <SubagentPill>{run.policy.kind}</SubagentPill>
                <SubagentPill tone={run.policy.writePolicy === "deny" ? "error" : run.policy.writePolicy === "claim_required" ? "running" : "default"}>
                  {run.policy.writePolicy}
                </SubagentPill>
              </>
            )}
            <SubagentPill tone={isRunning ? "running" : "done"}>{run.status}</SubagentPill>
          </div>
        </div>
        {isRunning && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onInterrupt(run.runId)}
            disabled={!canInterrupt}
            className="h-7 shrink-0 px-2 text-[11px]"
            title={run.interruptReason ?? "Interrupt is scoped to the parent session"}
          >
            <Pause className="h-3 w-3" />
          </Button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10.5px]" style={{ color: "var(--oc-text-muted)" }}>
        <SubagentMeta label="started" value={formatTime(run.startedAt)} />
        <SubagentMeta label="elapsed" value={formatDuration(elapsedMs)} />
        <SubagentMeta label="parent" value={shortId(run.parentSessionId, 12)} title={run.parentSessionId} />
        {run.permissionMode && (
          <SubagentMeta label="mode" value={run.permissionMode} />
        )}
        {run.policy && (
          <SubagentMeta label="conflict" value={run.policy.conflictMode} />
        )}
        {run.toolSummary && observedTools > 0 && (
          <>
            <SubagentMeta
              label="tools"
              value={`${run.toolSummary.started}/${run.toolSummary.completed}/${run.toolSummary.failed}`}
              title="started/completed/failed"
            />
            {run.toolSummary.lastToolName && (
              <SubagentMeta
                label="last tool"
                value={shortId(run.toolSummary.lastToolName, 18)}
                title={`${run.toolSummary.lastStatus ?? "observed"} ${run.toolSummary.lastToolName}${run.toolSummary.lastAt ? ` at ${formatTime(run.toolSummary.lastAt)}` : ""}`}
              />
            )}
          </>
        )}
      </div>

      {run.toolSummary && run.toolSummary.toolNames.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {run.toolSummary.toolNames.slice(0, 6).map((toolName) => (
            <SubagentPill key={toolName} title={toolName}>{shortId(toolName, 18)}</SubagentPill>
          ))}
          {run.toolSummary.toolNames.length > 6 && (
            <SubagentPill>+{run.toolSummary.toolNames.length - 6} tools</SubagentPill>
          )}
        </div>
      )}

      {run.policy?.description && (
        <p className="mt-2 line-clamp-2 text-[10.5px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
          {run.policy.description}
        </p>
      )}

      {(run.parentTranscriptPath || run.subagentTranscriptPath) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {run.parentTranscriptPath && (
            <SubagentPill title={run.parentTranscriptPath}>parent transcript</SubagentPill>
          )}
          {run.subagentTranscriptPath && (
            <SubagentPill title={run.subagentTranscriptPath}>subagent transcript</SubagentPill>
          )}
        </div>
      )}

      {run.lastAssistantMessage && (
        <p
          className="mt-2 line-clamp-3 rounded border px-2 py-1.5 text-[11px] leading-relaxed"
          style={{
            background: "var(--oc-bg1)",
            borderColor: "var(--oc-border)",
            color: "var(--oc-text-dim)",
          }}
        >
          {run.lastAssistantMessage}
        </p>
      )}

      {isRunning && (
        <p className="mt-2 text-[10px]" style={{ color: "var(--oc-text-muted)" }}>
          Interrupt uses SDK parent-session boundary.
        </p>
      )}
    </div>
  );
}

function SubagentPill({
  children,
  title,
  tone = "default",
}: {
  children: ReactNode;
  title?: string;
  tone?: "default" | "running" | "done" | "error";
}) {
  const color = tone === "running"
    ? "var(--oc-yellow)"
    : tone === "done"
      ? "var(--oc-green)"
      : tone === "error"
        ? "var(--oc-red)"
      : "var(--oc-text-muted)";

  return (
    <span
      className="rounded border px-1.5 py-px text-[10px]"
      title={title}
      style={{
        borderColor: "var(--oc-border)",
        color,
        fontFamily: "var(--oc-mono)",
      }}
    >
      {children}
    </span>
  );
}

function SubagentMeta({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="uppercase tracking-[0.5px]" style={{ color: "var(--oc-text-muted)" }}>
        {label}
      </div>
      <div
        className="truncate"
        title={title ?? value}
        style={{ color: "var(--oc-text-dim)", fontFamily: "var(--oc-mono)" }}
      >
        {value}
      </div>
    </div>
  );
}

function diagnosticsRunUrl(serverId: string, runId: string): string {
  const params = new URLSearchParams({
    includeLogs: "true",
    runId,
    diagnosticEventLimit: "300",
    routeDecisionLimit: "25",
  });
  return `/api/fleet/${serverId}/diagnostics/export?${params.toString()}`;
}

function RunDiagnosticsLink({
  serverId,
  runId,
}: {
  serverId: string;
  runId: string;
}) {
  return (
    <a
      href={diagnosticsRunUrl(serverId, runId)}
      download={`anthroclaw-run-${runId}-diagnostics.json`}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border"
      style={{
        borderColor: "var(--oc-border)",
        color: "var(--oc-text-muted)",
        background: "var(--oc-bg2)",
      }}
      title="Download diagnostics for this run"
    >
      <Download className="h-3 w-3" />
    </a>
  );
}

const toolbarControlClassName =
  "h-8 rounded-md border border-[var(--oc-border)] bg-[var(--oc-bg3)] px-2 text-xs text-[var(--color-foreground)] outline-none transition-colors [color-scheme:dark] placeholder:text-[var(--oc-text-muted)] focus:border-[var(--oc-accent-ring)] focus:ring-1 focus:ring-[var(--oc-accent-ring)] disabled:cursor-not-allowed disabled:opacity-60";

function ToolbarSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={cn("relative block", className)}>
      <select
        className={cn(toolbarControlClassName, "w-full cursor-pointer appearance-none pr-7")}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--oc-text-muted)]" />
    </label>
  );
}

function ToolbarTextInput({
  className,
  icon,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  return (
    <label className={cn("relative block", className)}>
      {icon && (
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--oc-text-muted)]">
          {icon}
        </span>
      )}
      <input
        className={cn(toolbarControlClassName, "w-full", icon && "pl-7")}
        {...props}
      />
    </label>
  );
}

function ToolbarCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-[var(--oc-border)] bg-[var(--oc-bg3)] px-2 text-xs text-[var(--color-foreground)] transition-transform active:translate-y-px">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--oc-accent)]"
      />
      <span>{children}</span>
    </label>
  );
}

function shortId(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 3))}...`;
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(value: number): string {
  const safe = Math.max(0, value);
  if (safe < 1000) return `${safe}ms`;
  const seconds = Math.floor(safe / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}


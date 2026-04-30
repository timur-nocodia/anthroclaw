"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Bot,
  CheckSquare,
  ChevronRight,
  Globe,
  History,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Square,
  Tag,
  Timer,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: "/", description: "Focus search" },
  { keys: "j / ↓", description: "Move focus down" },
  { keys: "k / ↑", description: "Move focus up" },
  { keys: "Enter", description: "Open focused session" },
  { keys: "x", description: "Toggle selection on focused row" },
  { keys: "a", description: "Select all visible" },
  { keys: "⌫ / Delete", description: "Delete selected (with confirm)" },
  { keys: "Esc", description: "Clear selection / close cheatsheet / blur input" },
  { keys: "?", description: "Toggle this cheatsheet" },
];

interface AgentSummary {
  id: string;
  model?: string;
}

interface SessionProvenance {
  source: "channel" | "web" | "cron" | "heartbeat";
  channel: string;
  peerId?: string;
  threadId?: string;
  status: "running" | "succeeded" | "failed" | "interrupted";
  startedAt: number;
}

interface AgentSession {
  sessionId: string;
  summary: string;
  customTitle?: string;
  labels?: string[];
  lastModified: number;
  activeKeys?: string[];
  messageCount?: number;
  provenance?: SessionProvenance;
  firstMessage?: { type: string; uuid: string; text: string };
  lastMessage?: { type: string; uuid: string; text: string };
}

const SOURCE_OPTIONS = ["all", "web", "channel", "cron", "heartbeat"] as const;
const STATUS_OPTIONS = ["all", "running", "succeeded", "failed", "interrupted"] as const;
type SourceFilter = (typeof SOURCE_OPTIONS)[number];
type StatusFilter = (typeof STATUS_OPTIONS)[number];

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function sourceIcon(source: string | undefined) {
  if (source === "web") return Globe;
  if (source === "cron") return Timer;
  if (source === "heartbeat") return Zap;
  return Smartphone;
}

function sessionTitle(session: AgentSession): string {
  if (session.customTitle?.trim()) return session.customTitle.trim();
  const summary = session.summary?.trim();
  if (summary && summary !== session.sessionId) return summary;
  const first = session.firstMessage?.text?.trim();
  if (first) return first.slice(0, 80);
  return session.sessionId;
}

function statusColor(status: string | undefined): string {
  switch (status) {
    case "succeeded":
      return "var(--oc-green)";
    case "running":
      return "var(--oc-yellow)";
    case "failed":
      return "#f87171";
    case "interrupted":
      return "var(--oc-text-muted)";
    default:
      return "var(--oc-text-muted)";
  }
}

function SessionsRowSkeleton() {
  return (
    <ul
      className="divide-y"
      style={{ borderColor: "var(--oc-border)" }}
      aria-busy="true"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 px-5 py-3"
          style={{ borderColor: "var(--oc-border)" }}
        >
          <div
            className="h-4 w-4 animate-pulse rounded-sm"
            style={{ background: "var(--oc-bg2)" }}
          />
          <div className="flex flex-1 flex-col gap-1.5">
            <div
              className="h-3 animate-pulse rounded"
              style={{ background: "var(--oc-bg2)", width: `${50 + ((i * 7) % 35)}%` }}
            />
            <div
              className="h-2.5 animate-pulse rounded"
              style={{ background: "var(--oc-bg2)", width: `${25 + ((i * 11) % 25)}%`, opacity: 0.6 }}
            />
          </div>
          <div
            className="h-2.5 w-12 animate-pulse rounded"
            style={{ background: "var(--oc-bg2)", opacity: 0.5 }}
          />
        </li>
      ))}
    </ul>
  );
}

export default function SessionsListPage() {
  const params = useParams();
  const router = useRouter();
  const serverId = params.serverId as string;
  const agentId = params.agentId as string;

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [labelEditorOpen, setLabelEditorOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [bulkLabelLoading, setBulkLabelLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showCheatsheet, setShowCheatsheet] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    fetch(`/api/fleet/${serverId}/agents`)
      .then((r) => r.json())
      .then((d) => setAgents(Array.isArray(d) ? d : d.agents ?? []))
      .catch(() => setAgents([]));
  }, [serverId]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      query.set("limit", "100");
      if (search.trim()) query.set("search", search.trim());
      if (sourceFilter !== "all") query.set("source", sourceFilter);
      if (statusFilter !== "all") query.set("status", statusFilter);
      const res = await fetch(`/api/fleet/${serverId}/agents/${agentId}/sessions?${query.toString()}`);
      if (!res.ok) {
        setError(`Failed to load: HTTP ${res.status}`);
        setSessions([]);
        return;
      }
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (err) {
      setError((err as Error).message);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [agentId, serverId, search, sourceFilter, statusFilter]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // Reset focused row when session list changes
  useEffect(() => {
    setFocusedIndex((prev) => (sessions.length === 0 ? 0 : Math.min(prev, sessions.length - 1)));
  }, [sessions.length]);

  const totalSessions = sessions.length;
  const activeCount = useMemo(
    () => sessions.filter((s) => (s.activeKeys?.length ?? 0) > 0).length,
    [sessions],
  );
  const knownLabels = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) for (const l of s.labels ?? []) set.add(l);
    return [...set].sort();
  }, [sessions]);

  const clearSelection = () => {
    setSelected(new Set());
    setLastSelectedIndex(null);
    setConfirmBulkDelete(false);
  };

  const toggleSelectionAt = (index: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const sessionId = sessions[index]?.sessionId;
    if (!sessionId) return;

    if (event.shiftKey && lastSelectedIndex !== null && lastSelectedIndex !== index) {
      const [start, end] = lastSelectedIndex < index
        ? [lastSelectedIndex, index]
        : [index, lastSelectedIndex];
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const id = sessions[i]?.sessionId;
          if (id) next.add(id);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(sessionId)) next.delete(sessionId);
        else next.add(sessionId);
        return next;
      });
    }
    setLastSelectedIndex(index);
    setConfirmBulkDelete(false);
  };

  const selectAllVisible = () => {
    setSelected(new Set(sessions.map((s) => s.sessionId)));
    setConfirmBulkDelete(false);
  };

  const openFocusedSession = useCallback(() => {
    const session = sessions[focusedIndex];
    if (!session) return;
    router.push(`/fleet/${serverId}/sessions/${agentId}/${encodeURIComponent(session.sessionId)}`);
  }, [agentId, focusedIndex, router, serverId, sessions]);

  const toggleFocusedSelection = useCallback(() => {
    const session = sessions[focusedIndex];
    if (!session) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(session.sessionId)) next.delete(session.sessionId);
      else next.add(session.sessionId);
      return next;
    });
    setLastSelectedIndex(focusedIndex);
    setConfirmBulkDelete(false);
  }, [focusedIndex, sessions]);

  // Global keyboard shortcuts
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = isTypingTarget(e.target);

      if (e.key === "Escape") {
        if (typing) {
          (e.target as HTMLElement).blur();
          return;
        }
        if (showCheatsheet) {
          setShowCheatsheet(false);
          return;
        }
        if (selected.size > 0) {
          clearSelection();
          return;
        }
        return;
      }

      if (typing) return;

      switch (e.key) {
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          return;
        case "?":
          e.preventDefault();
          setShowCheatsheet((v) => !v);
          return;
        case "j":
        case "ArrowDown":
          if (sessions.length === 0) return;
          e.preventDefault();
          setFocusedIndex((i) => Math.min(sessions.length - 1, i + 1));
          return;
        case "k":
        case "ArrowUp":
          if (sessions.length === 0) return;
          e.preventDefault();
          setFocusedIndex((i) => Math.max(0, i - 1));
          return;
        case "Enter":
          if (sessions.length === 0) return;
          e.preventDefault();
          openFocusedSession();
          return;
        case "x":
          if (sessions.length === 0) return;
          e.preventDefault();
          toggleFocusedSelection();
          return;
        case "a":
          if (sessions.length === 0) return;
          e.preventDefault();
          selectAllVisible();
          return;
        case "Backspace":
        case "Delete":
          if (selected.size === 0) return;
          e.preventDefault();
          setConfirmBulkDelete(true);
          return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFocusedSession, sessions.length, selected.size, showCheatsheet, toggleFocusedSelection]);

  // Scroll focused row into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.querySelector<HTMLLIElement>(`[data-row-index="${focusedIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  const performBulkLabel = async (action: "addLabels" | "removeLabels") => {
    const value = labelDraft.trim();
    if (!value || selected.size === 0) return;
    setBulkLabelLoading(true);
    try {
      const res = await fetch(`/api/fleet/${serverId}/agents/${agentId}/sessions/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sessionIds: [...selected], labels: [value] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { updated: number; errors: { sessionId: string; message: string }[] };
      const verb = action === "addLabels" ? "Tagged" : "Untagged";
      if (data.errors.length > 0) {
        toast.error(`${verb} ${data.updated}, failed ${data.errors.length}`);
      } else {
        toast.success(`${verb} ${data.updated} session${data.updated === 1 ? "" : "s"}`);
      }
      setLabelDraft("");
      setLabelEditorOpen(false);
      void loadSessions();
    } catch (err) {
      toast.error(`Bulk label failed: ${(err as Error).message}`);
    } finally {
      setBulkLabelLoading(false);
    }
  };

  const performBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    try {
      const res = await fetch(`/api/fleet/${serverId}/agents/${agentId}/sessions/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", sessionIds: [...selected] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { deleted: number; errors: { sessionId: string; message: string }[] };
      if (data.errors.length > 0) {
        toast.error(`Deleted ${data.deleted}, failed ${data.errors.length}`);
      } else {
        toast.success(`Deleted ${data.deleted} session${data.deleted === 1 ? "" : "s"}`);
      }
      clearSelection();
      void loadSessions();
    } catch (err) {
      toast.error(`Bulk delete failed: ${(err as Error).message}`);
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--oc-bg0)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
      >
        <History className="h-4 w-4" style={{ color: "var(--oc-accent)" }} />
        <h1 className="text-[14px] font-semibold" style={{ color: "var(--color-foreground)" }}>
          Sessions
        </h1>

        {/* Agent picker */}
        <div className="relative ml-3">
          <select
            value={agentId}
            onChange={(e) => router.push(`/fleet/${serverId}/sessions/${e.target.value}`)}
            className="appearance-none rounded-[5px] border px-2.5 py-1 pr-7 text-[12px] outline-none"
            style={{
              background: "var(--oc-bg0)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {agents.length === 0 && <option value={agentId}>{agentId}</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id}
              </option>
            ))}
          </select>
          <ChevronRight
            className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90"
            style={{ color: "var(--oc-text-muted)" }}
          />
        </div>

        <div className="ml-auto flex items-center gap-3 text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
          <span style={{ fontFamily: "var(--oc-mono)" }}>
            {totalSessions} total{activeCount > 0 ? ` · ${activeCount} active` : ""}
          </span>
          <button
            onClick={loadSessions}
            disabled={loading}
            className="flex h-7 w-7 items-center justify-center rounded-[5px] transition-colors hover:bg-[var(--oc-bg2)] disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Filters / Bulk bar */}
      {selected.size === 0 ? (
        <div
          className="flex items-center gap-2 border-b px-5 py-2.5"
          style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
        >
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: "var(--oc-text-muted)" }}
            />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search session content..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-[5px] border bg-transparent pl-8 pr-3 text-[12.5px] outline-none placeholder:text-[var(--oc-text-muted)]"
              style={{
                background: "var(--oc-bg0)",
                borderColor: "var(--oc-border)",
                color: "var(--color-foreground)",
              }}
            />
          </div>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            className="h-8 rounded-[5px] border px-2 text-[12px] outline-none"
            style={{
              background: "var(--oc-bg0)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
            }}
          >
            {SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "Any source" : s}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-8 rounded-[5px] border px-2 text-[12px] outline-none"
            style={{
              background: "var(--oc-bg0)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
            }}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "Any status" : s}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 border-b px-5 py-2"
          style={{ borderColor: "var(--oc-border)", background: "var(--oc-accent-soft)" }}
        >
          <span
            className="text-[12.5px] font-medium"
            style={{ color: "var(--oc-accent)" }}
          >
            {selected.size} selected
          </span>
          <button
            onClick={selectAllVisible}
            disabled={selected.size === sessions.length}
            className="h-7 rounded-[5px] px-2 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)] disabled:opacity-40"
            style={{ color: "var(--oc-text-dim)" }}
          >
            Select all visible ({sessions.length})
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            {labelEditorOpen ? (
              <>
                <input
                  autoFocus
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void performBulkLabel("addLabels");
                    if (e.key === "Escape") {
                      setLabelDraft("");
                      setLabelEditorOpen(false);
                    }
                  }}
                  list="bulk-label-suggestions"
                  placeholder="label"
                  disabled={bulkLabelLoading}
                  className="h-7 rounded-[5px] border bg-transparent px-2 text-[11.5px] outline-none"
                  style={{
                    background: "var(--oc-bg0)",
                    borderColor: "var(--oc-accent)",
                    color: "var(--color-foreground)",
                    minWidth: 100,
                  }}
                />
                <datalist id="bulk-label-suggestions">
                  {knownLabels.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
                <button
                  onClick={() => void performBulkLabel("addLabels")}
                  disabled={bulkLabelLoading || !labelDraft.trim()}
                  className="h-7 rounded-[5px] px-2 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)] disabled:opacity-40"
                  style={{ color: "var(--oc-text-dim)" }}
                  title="Add label to selected"
                >
                  Add
                </button>
                <button
                  onClick={() => void performBulkLabel("removeLabels")}
                  disabled={bulkLabelLoading || !labelDraft.trim()}
                  className="h-7 rounded-[5px] px-2 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)] disabled:opacity-40"
                  style={{ color: "var(--oc-text-dim)" }}
                  title="Remove label from selected"
                >
                  Remove
                </button>
                <button
                  onClick={() => {
                    setLabelDraft("");
                    setLabelEditorOpen(false);
                  }}
                  disabled={bulkLabelLoading}
                  className="h-7 rounded-[5px] px-2 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)]"
                  style={{ color: "var(--oc-text-muted)" }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setLabelEditorOpen(true)}
                className="flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)]"
                style={{ color: "var(--oc-text-dim)" }}
                title="Tag selected"
              >
                <Tag className="h-3 w-3" />
                <span>Tag</span>
              </button>
            )}
            {confirmBulkDelete ? (
              <>
                <button
                  onClick={performBulkDelete}
                  disabled={bulkDeleting}
                  className="flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] font-medium disabled:opacity-50"
                  style={{ background: "rgba(248,113,113,0.18)", color: "#f87171" }}
                >
                  <Trash2 className="h-3 w-3" />
                  <span>{bulkDeleting ? "Deleting..." : `Confirm delete ${selected.size}`}</span>
                </button>
                <button
                  onClick={() => setConfirmBulkDelete(false)}
                  disabled={bulkDeleting}
                  className="h-7 rounded-[5px] px-2 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)]"
                  style={{ color: "var(--oc-text-muted)" }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmBulkDelete(true)}
                className="flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)]"
                style={{ color: "#f87171" }}
                title="Delete selected"
              >
                <Trash2 className="h-3 w-3" />
                <span>Delete</span>
              </button>
            )}
            <button
              onClick={clearSelection}
              disabled={bulkDeleting}
              className="flex h-7 w-7 items-center justify-center rounded-[5px] transition-colors hover:bg-[var(--oc-bg2)]"
              style={{ color: "var(--oc-text-muted)" }}
              title="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-auto">
        {error && (
          <div className="px-5 py-3 text-[12px]" style={{ color: "#f87171" }}>
            {error}
          </div>
        )}
        {loading && sessions.length === 0 && <SessionsRowSkeleton />}
        {!error && !loading && sessions.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-5 py-10 text-center">
            <Bot className="h-8 w-8" style={{ color: "var(--oc-text-muted)" }} />
            <div className="text-[13px]" style={{ color: "var(--oc-text-dim)" }}>
              No sessions yet for this agent.
            </div>
            <div className="text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
              Start a conversation in Test Chat or send a message via a connected channel.
            </div>
          </div>
        )}
        <ul ref={listRef} className="divide-y" style={{ borderColor: "var(--oc-border)" }}>
          {sessions.map((session, index) => {
            const SourceIcon = sourceIcon(session.provenance?.source);
            const isActive = (session.activeKeys?.length ?? 0) > 0;
            const status = session.provenance?.status;
            const isSelected = selected.has(session.sessionId);
            const inBulkMode = selected.size > 0;
            const isFocused = index === focusedIndex;
            return (
              <li
                key={session.sessionId}
                data-row-index={index}
                style={{
                  borderColor: "var(--oc-border)",
                  background: isSelected ? "var(--oc-accent-soft)" : undefined,
                  boxShadow: isFocused ? "inset 2px 0 0 0 var(--oc-accent)" : undefined,
                }}
                className="group"
              >
                <Link
                  href={`/fleet/${serverId}/sessions/${agentId}/${encodeURIComponent(session.sessionId)}`}
                  className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-[var(--oc-bg1)]"
                  onClick={(e) => {
                    if (inBulkMode) toggleSelectionAt(index, e);
                  }}
                >
                  {/* Selection checkbox */}
                  <button
                    onClick={(e) => toggleSelectionAt(index, e)}
                    className={cn(
                      "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] transition-opacity",
                      inBulkMode || isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                    style={{
                      color: isSelected ? "var(--oc-accent)" : "var(--oc-text-muted)",
                    }}
                    title={isSelected ? "Deselect" : "Select"}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-4 w-4" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>

                  {/* Source icon */}
                  <div
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: "var(--oc-bg2)",
                      border: "1px solid var(--oc-border)",
                    }}
                  >
                    <SourceIcon className="h-3.5 w-3.5" style={{ color: "var(--oc-text-dim)" }} />
                  </div>

                  {/* Title + meta */}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate text-[13px] font-medium"
                        style={{ color: "var(--color-foreground)" }}
                      >
                        {sessionTitle(session)}
                      </span>
                      {isActive && (
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            background: "var(--oc-green)",
                            animation: "pulse 1.5s infinite",
                          }}
                          title="Active session"
                        />
                      )}
                      {status && status !== "succeeded" && (
                        <span
                          className="rounded px-1.5 py-px text-[9.5px] uppercase tracking-[0.4px]"
                          style={{
                            color: statusColor(status),
                            background: "var(--oc-bg2)",
                            fontFamily: "var(--oc-mono)",
                          }}
                        >
                          {status}
                        </span>
                      )}
                    </div>

                    <div
                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]"
                      style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
                    >
                      {session.provenance?.channel && (
                        <span>{session.provenance.channel}</span>
                      )}
                      {session.provenance?.peerId && (
                        <>
                          <span>·</span>
                          <span className="truncate">{session.provenance.peerId}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>{formatRelative(session.lastModified)}</span>
                      {typeof session.messageCount === "number" && (
                        <>
                          <span>·</span>
                          <span>
                            <MessageSquare className="-mt-0.5 mr-1 inline h-2.5 w-2.5" />
                            {session.messageCount}
                          </span>
                        </>
                      )}
                    </div>

                    {(session.labels?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {session.labels?.map((label) => (
                          <span
                            key={label}
                            className="rounded-[3px] px-1.5 py-px text-[10px]"
                            style={{
                              background: "var(--oc-bg2)",
                              color: "var(--oc-text-dim)",
                              border: "1px solid var(--oc-border)",
                            }}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Resume in chat quick action */}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      router.push(
                        `/fleet/${serverId}/chat/${agentId}?session=${encodeURIComponent(session.sessionId)}`,
                      );
                    }}
                    title="Open in Test Chat"
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] opacity-0 transition-all hover:bg-[var(--oc-bg2)] group-hover:opacity-100"
                  >
                    <Send className="h-3 w-3" style={{ color: "var(--oc-text-muted)" }} />
                  </button>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <Dialog open={showCheatsheet} onOpenChange={setShowCheatsheet}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5 pt-1 text-[12.5px]">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex items-center justify-between gap-3">
                <span style={{ color: "var(--oc-text-dim)" }}>{s.description}</span>
                <kbd
                  className="rounded border px-1.5 py-0.5 text-[11px]"
                  style={{
                    background: "var(--oc-bg2)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                    fontFamily: "var(--oc-mono)",
                  }}
                >
                  {s.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Download,
  GitFork,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageBubble, type ChatMessage } from "@/components/chat-message";
import { storedEntriesToChatMessages, type StoredSessionEntry } from "@/lib/normalize-session";
import { cn } from "@/lib/utils";

interface SessionMessageView {
  type: "user" | "assistant" | "system";
  uuid: string;
  sessionId?: string;
  text: string;
  message?: unknown;
}

interface SessionProvenance {
  source: "channel" | "web" | "cron";
  channel: string;
  peerId?: string;
  threadId?: string;
  sessionKey?: string;
  status: "running" | "succeeded" | "failed" | "interrupted";
  startedAt: number;
}

interface SessionDetailsResponse {
  sessionId: string;
  summary?: string;
  customTitle?: string;
  labels?: string[];
  lastModified?: number;
  activeKeys?: string[];
  messageCount?: number;
  provenance?: SessionProvenance;
  messages: SessionMessageView[];
}

interface SessionMeta {
  sessionId: string;
  customTitle?: string;
  labels?: string[];
  activeKeys?: string[];
  messageCount?: number;
  provenance?: SessionProvenance;
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

function SkeletonBar({ width, height = 12 }: { width: string | number; height?: number }) {
  return (
    <div
      className="animate-pulse rounded"
      style={{
        width,
        height,
        background: "var(--oc-bg2)",
      }}
    />
  );
}

function SkeletonBubble({ side, lines }: { side: "left" | "right"; lines: number }) {
  const widths = ["86%", "72%", "94%", "60%", "80%"];
  return (
    <div className={cn("flex w-full", side === "right" ? "justify-end" : "justify-start")}>
      <div
        className="flex max-w-[78%] flex-col gap-2 rounded-[10px] px-3 py-2.5"
        style={{
          background: side === "right" ? "var(--oc-accent-soft)" : "var(--oc-bg1)",
          border: "1px solid var(--oc-border)",
          minWidth: 220,
        }}
      >
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonBar key={i} width={widths[i % widths.length]} height={10} />
        ))}
      </div>
    </div>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <SkeletonBubble side="right" lines={2} />
      <SkeletonBubble side="left" lines={4} />
      <SkeletonBubble side="right" lines={1} />
      <SkeletonBubble side="left" lines={3} />
    </div>
  );
}

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const serverId = params.serverId as string;
  const agentId = params.agentId as string;
  const sessionId = decodeURIComponent(params.sessionId as string);

  const [details, setDetails] = useState<SessionDetailsResponse | null>(null);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingLabel, setAddingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detailUrl = `/api/fleet/${serverId}/agents/${agentId}/sessions/${encodeURIComponent(sessionId)}?limit=500&includeSystemMessages=${showSystem}`;
      const detailRes = await fetch(detailUrl);

      if (!detailRes.ok) {
        setError(`Failed to load: HTTP ${detailRes.status}`);
        setDetails(null);
        return;
      }
      const detailData = (await detailRes.json()) as SessionDetailsResponse;
      setDetails(detailData);
      setMeta({
        sessionId: detailData.sessionId,
        customTitle: detailData.customTitle,
        labels: detailData.labels,
        activeKeys: detailData.activeKeys,
        messageCount: detailData.messageCount,
        provenance: detailData.provenance,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [agentId, serverId, sessionId, showSystem]);

  const loadAllLabels = useCallback(async () => {
    if (allLabels.length > 0) return;
    try {
      const res = await fetch(`/api/fleet/${serverId}/agents/${agentId}/sessions?limit=200`);
      if (!res.ok) return;
      const data = await res.json();
      const sessions: SessionMeta[] = data.sessions ?? [];
      const collected = new Set<string>();
      for (const s of sessions) for (const l of s.labels ?? []) collected.add(l);
      setAllLabels([...collected].sort());
    } catch {
      /* autocomplete is optional */
    }
  }, [agentId, serverId, allLabels.length]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const messages: ChatMessage[] = useMemo(() => {
    if (!details) return [];
    const stored: StoredSessionEntry[] = details.messages.map((m, i) => ({
      type: m.type,
      uuid: m.uuid || `${details.sessionId}-${i}`,
      text: m.text,
      message: m.message,
    }));
    return storedEntriesToChatMessages(stored);
  }, [details]);

  const title = meta?.customTitle?.trim() || details?.summary || sessionId;

  const startEditTitle = () => {
    setTitleDraft(title || "");
    setEditingTitle(true);
  };

  const saveTitle = async () => {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === title) return;
    try {
      const res = await fetch(
        `/api/fleet/${serverId}/agents/${agentId}/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: next }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Title updated");
      void loadAll();
    } catch (err) {
      toast.error(`Rename failed: ${(err as Error).message}`);
    }
  };

  const fork = async () => {
    try {
      const res = await fetch(`/api/fleet/${serverId}/agents/${agentId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fork", sessionId, title: `Fork of ${title}` }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      toast.success("Session forked");
      if (typeof data.sessionId === "string") {
        router.push(`/fleet/${serverId}/sessions/${agentId}/${encodeURIComponent(data.sessionId)}`);
      }
    } catch (err) {
      toast.error(`Fork failed: ${(err as Error).message}`);
    }
  };

  const remove = async () => {
    try {
      const res = await fetch(
        `/api/fleet/${serverId}/agents/${agentId}/sessions/${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Session deleted");
      router.push(`/fleet/${serverId}/sessions/${agentId}`);
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const copySessionId = () => {
    void navigator.clipboard.writeText(sessionId);
    toast.success("Session ID copied");
  };

  const exportSession = (format: "md" | "jsonl") => {
    const url = `/api/fleet/${serverId}/agents/${agentId}/sessions/${encodeURIComponent(sessionId)}/export?format=${format}`;
    window.open(url, "_blank");
  };

  const saveLabels = async (next: string[]) => {
    try {
      const res = await fetch(
        `/api/fleet/${serverId}/agents/${agentId}/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labels: next }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void loadAll();
    } catch (err) {
      toast.error(`Labels update failed: ${(err as Error).message}`);
    }
  };

  const addLabel = (raw: string) => {
    const value = raw.trim();
    setLabelDraft("");
    setAddingLabel(false);
    if (!value) return;
    const current = meta?.labels ?? [];
    if (current.includes(value)) return;
    void saveLabels([...current, value]);
  };

  const removeLabel = (label: string) => {
    const current = meta?.labels ?? [];
    void saveLabels(current.filter((l) => l !== label));
  };

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--oc-bg0)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
      >
        <Link
          href={`/fleet/${serverId}/sessions/${agentId}`}
          className="flex h-7 w-7 items-center justify-center rounded-[5px] transition-colors hover:bg-[var(--oc-bg2)]"
          title="Back to sessions"
        >
          <ArrowLeft className="h-3.5 w-3.5" style={{ color: "var(--oc-text-dim)" }} />
        </Link>

        {/* Title */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {loading && !details && !meta ? (
            <SkeletonBar width={260} height={14} />
          ) : editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="h-7 flex-1 rounded-[5px] border bg-transparent px-2 text-[13px] outline-none"
              style={{
                background: "var(--oc-bg0)",
                borderColor: "var(--oc-accent)",
                color: "var(--color-foreground)",
              }}
            />
          ) : (
            <button
              onClick={startEditTitle}
              className="group flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--oc-bg2)]"
              title="Click to rename"
            >
              <span
                className="truncate text-[13px] font-medium"
                style={{ color: "var(--color-foreground)" }}
              >
                {title}
              </span>
              <Pencil
                className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60"
                style={{ color: "var(--oc-text-muted)" }}
              />
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => router.push(`/fleet/${serverId}/chat/${agentId}?session=${encodeURIComponent(sessionId)}`)}
            className="flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)]"
            style={{ color: "var(--oc-text-dim)" }}
            title="Open in Test Chat"
          >
            <Send className="h-3 w-3" />
            <span>Open in chat</span>
          </button>
          <button
            onClick={fork}
            className="flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)]"
            style={{ color: "var(--oc-text-dim)" }}
            title="Fork session"
          >
            <GitFork className="h-3 w-3" />
            <span>Fork</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)]"
                style={{ color: "var(--oc-text-dim)" }}
                title="Export session"
              >
                <Download className="h-3 w-3" />
                <span>Export</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportSession("md")}>
                Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportSession("jsonl")}>
                Raw JSONL (.jsonl)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={remove}
                className="flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] font-medium"
                style={{ background: "rgba(248,113,113,0.15)", color: "#f87171" }}
              >
                <Trash2 className="h-3 w-3" />
                <span>Confirm delete</span>
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="h-7 rounded-[5px] px-2 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex h-7 w-7 items-center justify-center rounded-[5px] transition-colors hover:bg-[var(--oc-bg2)]"
              style={{ color: "var(--oc-text-muted)" }}
              title="Delete session"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Meta strip */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-5 py-2 text-[11px]"
        style={{
          borderColor: "var(--oc-border)",
          background: "var(--oc-bg1)",
          color: "var(--oc-text-muted)",
          fontFamily: "var(--oc-mono)",
        }}
      >
        <button
          onClick={copySessionId}
          className="group flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-[var(--oc-bg2)]"
          title="Copy session ID"
        >
          <span style={{ color: "var(--oc-text-dim)" }}>{sessionId}</span>
          <Copy className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-60" />
        </button>
        {meta?.provenance?.channel && (
          <>
            <span>·</span>
            <span>{meta.provenance.channel}</span>
          </>
        )}
        {meta?.provenance?.peerId && (
          <>
            <span>·</span>
            <span>{meta.provenance.peerId}</span>
          </>
        )}
        {meta?.provenance?.status && (
          <>
            <span>·</span>
            <span style={{ color: statusColor(meta.provenance.status) }}>
              {meta.provenance.status}
            </span>
          </>
        )}
        {(meta?.activeKeys?.length ?? 0) > 0 && (
          <>
            <span>·</span>
            <span style={{ color: "var(--oc-green)" }}>active</span>
          </>
        )}
        {typeof meta?.messageCount === "number" && (
          <>
            <span>·</span>
            <span>{meta.messageCount} msgs</span>
          </>
        )}

        <label className="ml-auto flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(e) => setShowSystem(e.target.checked)}
            className="h-3 w-3"
          />
          <span>Show system messages</span>
        </label>
      </div>

      {/* Labels */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b px-5 py-2"
        style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
      >
        <span
          className="text-[10px] uppercase tracking-[0.5px]"
          style={{ color: "var(--oc-text-muted)" }}
        >
          Labels
        </span>
        {(meta?.labels ?? []).map((label) => (
          <span
            key={label}
            className="group flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[10.5px]"
            style={{
              background: "var(--oc-bg2)",
              color: "var(--oc-text-dim)",
              border: "1px solid var(--oc-border)",
            }}
          >
            <span>{label}</span>
            <button
              onClick={() => removeLabel(label)}
              className="opacity-40 transition-opacity hover:opacity-100"
              title={`Remove "${label}"`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {addingLabel ? (
          <>
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={() => addLabel(labelDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setLabelDraft("");
                  setAddingLabel(false);
                }
              }}
              list="session-label-suggestions"
              placeholder="label"
              className="h-5 rounded-[3px] border bg-transparent px-1.5 text-[10.5px] outline-none"
              style={{
                background: "var(--oc-bg0)",
                borderColor: "var(--oc-accent)",
                color: "var(--color-foreground)",
                minWidth: 80,
              }}
            />
            <datalist id="session-label-suggestions">
              {allLabels
                .filter((l) => !(meta?.labels ?? []).includes(l))
                .map((l) => (
                  <option key={l} value={l} />
                ))}
            </datalist>
          </>
        ) : (
          <button
            onClick={() => {
              setAddingLabel(true);
              void loadAllLabels();
            }}
            className="flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[10.5px] transition-colors hover:bg-[var(--oc-bg2)]"
            style={{
              borderColor: "var(--oc-border)",
              borderStyle: "dashed",
              color: "var(--oc-text-muted)",
            }}
            title="Add label"
          >
            <Plus className="h-2.5 w-2.5" />
            <span>Add label</span>
          </button>
        )}
      </div>

      {/* Transcript */}
      <div className="flex flex-1 justify-center overflow-auto">
        <div className="w-full max-w-[720px] px-5 py-4">
          {loading && messages.length === 0 && <TranscriptSkeleton />}
          {error && (
            <div className="text-[12px]" style={{ color: "#f87171" }}>
              {error}
            </div>
          )}
          {!loading && !error && messages.length === 0 && (
            <div className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
              No messages in this session.
            </div>
          )}
          <div className={cn("flex flex-col gap-3", loading && "opacity-60")}>
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} toolCallDefaultOpen={false} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

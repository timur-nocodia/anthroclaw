"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowDown,
  Download,
  Pause,
  Play,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LogEntry {
  id: string;
  time: string;
  level: string;
  event: string;
  source: string;
  agentId: string;
  channel: string;
  msg: string;
  sessionId?: string;
  payload?: Record<string, unknown> | null;
}

const MAX_ENTRIES = 2000;

const LEVEL_COLORS: Record<string, string> = {
  error: "var(--oc-red)",
  warn: "var(--oc-yellow)",
  info: "var(--oc-text-dim)",
  debug: "var(--oc-text-muted)",
};

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export default function LogsPage() {
  const params = useParams();
  const serverId = params.serverId as string;

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [live, setLive] = useState(true);
  const [filters, setFilters] = useState({
    level: "all",
    source: "all",
    q: "",
  });
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [sources, setSources] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuckToBottom = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  // Start/stop SSE stream
  useEffect(() => {
    if (!live) {
      if (abortRef.current) abortRef.current.abort();
      return;
    }

    const abort = new AbortController();
    abortRef.current = abort;

    const levelParam = filters.level !== "all" ? `?level=${filters.level}` : "";

    (async () => {
      try {
        const res = await fetch(
          `/api/fleet/${serverId}/logs/stream${levelParam}`,
          { signal: abort.signal },
        );
        if (!res.ok || !res.body) return;

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
              const ev: LogEntry = JSON.parse(raw);
              if (!ev.id) ev.id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              setLogs((prev) => {
                const next = [...prev, ev];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
              });
              if (ev.source) {
                setSources((prev) => {
                  const next = new Set(prev);
                  next.add(ev.source);
                  return next;
                });
              }
            } catch {
              // skip invalid JSON
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          // stream ended or errored
        }
      }
    })();

    return () => {
      abort.abort();
      abortRef.current = null;
    };
  }, [live, serverId, filters.level]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current && stuckToBottom.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  // Filter logs
  const filtered = logs.filter((l) => {
    if (filters.level !== "all" && l.level !== filters.level) return false;
    if (filters.source !== "all" && l.source !== filters.source) return false;
    if (
      filters.q &&
      !`${l.msg} ${l.agentId} ${l.event} ${l.source}`
        .toLowerCase()
        .includes(filters.q.toLowerCase())
    )
      return false;
    return true;
  });

  const counts = logs.reduce(
    (a, l) => {
      a[l.level] = (a[l.level] || 0) + 1;
      return a;
    },
    {} as Record<string, number>,
  );

  // Virtualizer
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 20,
  });

  // Auto-scroll virtualizer
  useEffect(() => {
    if (stuckToBottom.current && filtered.length > 0) {
      virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
    }
  }, [filtered.length, virtualizer]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--oc-border)" }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div>
            <h1
              className="text-[15px] font-semibold"
              style={{ color: "var(--color-foreground)" }}
            >
              Logs
            </h1>
            <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
              Unified stream across gateway, agents, tools, and channels.
            </p>
          </div>
          <span
            className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--oc-border)",
              color: "var(--oc-text-muted)",
            }}
          >
            {logs.length.toLocaleString()} events
          </span>
          <span
            className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
            style={{
              background: live
                ? "rgba(74,222,128,0.15)"
                : "rgba(255,255,255,0.03)",
              border: `1px solid ${live ? "rgba(74,222,128,0.35)" : "var(--oc-border)"}`,
              color: live ? "var(--oc-green)" : "var(--oc-text-muted)",
            }}
          >
            {live ? "● live" : "◻ paused"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setLive((l) => !l)}>
            {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {live ? "Pause" : "Resume"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLogs([])}>
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="flex items-center gap-2.5 border-b px-5 py-2.5"
        style={{
          borderColor: "var(--oc-border)",
          background: "var(--oc-bg0)",
        }}
      >
        <Search className="h-3.5 w-3.5" style={{ color: "var(--oc-text-muted)" }} />
        <input
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          placeholder="Search message, agent, event..."
          className="min-w-0 flex-1 border-none bg-transparent text-xs outline-none"
          style={{
            color: "var(--color-foreground)",
            fontFamily: "var(--oc-mono)",
          }}
        />
        <select
          value={filters.level}
          onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value }))}
          className="h-7 cursor-pointer rounded border px-1.5 text-[11px]"
          style={{
            background: "var(--oc-bg3)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
          }}
        >
          <option value="all">All levels ({logs.length})</option>
          <option value="error">error ({counts.error ?? 0})</option>
          <option value="warn">warn ({counts.warn ?? 0})</option>
          <option value="info">info ({counts.info ?? 0})</option>
          <option value="debug">debug ({counts.debug ?? 0})</option>
        </select>
        <select
          value={filters.source}
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
          className="h-7 cursor-pointer rounded border px-1.5 text-[11px]"
          style={{
            background: "var(--oc-bg3)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
          }}
        >
          <option value="all">All sources</option>
          {Array.from(sources)
            .sort()
            .map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
        </select>
      </div>

      {/* Log list + detail */}
      <div
        className="flex flex-1 overflow-hidden"
        style={{ gridTemplateColumns: selected ? "1fr 380px" : "1fr" }}
      >
        {/* Virtualized log stream */}
        <div
          ref={parentRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto"
          style={{ background: "#07090d" }}
        >
          {filtered.length === 0 ? (
            <div
              className="p-10 text-center text-xs"
              style={{
                color: "var(--oc-text-muted)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              No events match your filters.
            </div>
          ) : (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const log = filtered[virtualRow.index];
                const isSelected = selected?.id === log.id;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className="grid cursor-pointer items-baseline gap-2.5 px-3.5"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns: "72px 56px 88px 96px 1fr",
                      fontFamily: "var(--oc-mono)",
                      fontSize: "11.5px",
                      lineHeight: "24px",
                      background: isSelected
                        ? "rgba(124, 156, 255, 0.1)"
                        : "transparent",
                      borderLeft: isSelected
                        ? "2px solid var(--oc-accent)"
                        : "2px solid transparent",
                    }}
                    onClick={() =>
                      setSelected((s) =>
                        s?.id === log.id ? null : log,
                      )
                    }
                  >
                    <span style={{ color: "var(--oc-text-muted)" }}>{log.time}</span>
                    <span
                      className="text-[10.5px] font-semibold uppercase"
                      style={{ color: LEVEL_COLORS[log.level] ?? "var(--oc-text-dim)" }}
                    >
                      {log.level}
                    </span>
                    <span style={{ color: "var(--oc-accent)" }}>{log.agentId}</span>
                    <span style={{ color: "var(--oc-text-muted)" }}>{log.event}</span>
                    <span
                      className="truncate"
                      style={{ color: "var(--oc-text-dim)" }}
                    >
                      {log.msg}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div
            className="flex flex-col overflow-hidden"
            style={{
              borderLeft: "1px solid var(--oc-border)",
              background: "var(--oc-bg0)",
              width: 380,
            }}
          >
            <div
              className="flex items-center justify-between px-3.5 py-3"
              style={{ borderBottom: "1px solid var(--oc-border)" }}
            >
              <span
                className="text-xs font-semibold"
                style={{ color: "var(--color-foreground)" }}
              >
                Event detail
              </span>
              <button
                onClick={() => setSelected(null)}
                className="flex items-center justify-center"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--oc-text-muted)",
                  cursor: "pointer",
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-3.5 overflow-auto p-3.5">
              <DetailKV k="event" v={selected.event} />
              <DetailKV k="level" v={selected.level} />
              <DetailKV k="agent_id" v={selected.agentId} />
              <DetailKV k="channel" v={selected.channel} />
              <DetailKV k="session_id" v={selected.sessionId ?? "---"} />
              <DetailKV k="time" v={selected.time} />
              <div>
                <div
                  className="mb-1 text-[9.5px] uppercase tracking-[0.5px]"
                  style={{
                    color: "var(--oc-text-muted)",
                    fontFamily: "var(--oc-mono)",
                  }}
                >
                  message
                </div>
                <div
                  className="whitespace-pre-wrap rounded border p-2.5 text-xs leading-relaxed"
                  style={{
                    background: "var(--oc-bg2)",
                    borderColor: "var(--oc-border)",
                    fontFamily: "var(--oc-mono)",
                    color: "var(--color-foreground)",
                  }}
                >
                  {selected.msg}
                </div>
              </div>
              {selected.payload && (
                <div>
                  <div
                    className="mb-1 text-[9.5px] uppercase tracking-[0.5px]"
                    style={{
                      color: "var(--oc-text-muted)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  >
                    payload
                  </div>
                  <pre
                    className="overflow-auto rounded border p-2.5 text-[11.5px]"
                    style={{
                      margin: 0,
                      background: "var(--oc-bg2)",
                      borderColor: "var(--oc-border)",
                      fontFamily: "var(--oc-mono)",
                      color: "var(--oc-text-dim)",
                    }}
                  >
                    {JSON.stringify(selected.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailKV({ k, v }: { k: string; v: string }) {
  return (
    <div
      className="grid gap-2 text-xs"
      style={{
        gridTemplateColumns: "100px 1fr",
        fontFamily: "var(--oc-mono)",
      }}
    >
      <span style={{ color: "var(--oc-text-muted)" }}>{k}</span>
      <span style={{ color: "var(--color-foreground)" }}>{v}</span>
    </div>
  );
}

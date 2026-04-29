"use client";

/**
 * Plan 3 Task B4 — byte-exact message drill modal.
 *
 * Pairs with B3's DagPanel: clicking a node card opens this modal which
 * fetches /api/agents/[agentId]/lcm/nodes/[nodeId] and renders:
 *
 *   - For D0 nodes (source_type='messages'): the raw source messages, one
 *     per row, with role/source metadata. A "lossless verified" chip shows
 *     the recovered count + total source tokens.
 *
 *   - For D1+ nodes (source_type='nodes'): the immediate child nodes as
 *     clickable rows. Click a child → push that node onto a drill stack and
 *     fetch its detail; the modal re-renders for the new top of stack. A
 *     "Back" button pops the stack.
 *
 * The modal owns a stack of `{ nodeId, detail | null, error | null }` so we
 * can render breadcrumb + back without re-fetching when popping. Each push
 * triggers a fresh fetch (no aggressive caching — the LCM DB is mutable).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/* ------------------------------------------------------------------ */
/*  Types — mirror B1 detail route                                     */
/* ------------------------------------------------------------------ */

type DagNodeChildMessage = {
  kind: "message";
  store_id: number;
  role: string;
  content: string;
  ts: number;
  source: string;
};

type DagNodeChildNode = {
  kind: "node";
  node_id: string;
  depth: number;
  summary_preview: string;
  child_count: number;
};

type DagNodeChild = DagNodeChildMessage | DagNodeChildNode;

interface DagNodeDetail {
  node_id: string;
  session_id: string;
  depth: number;
  summary: string;
  token_count: number;
  source_token_count: number;
  source_type: "messages" | "nodes";
  source_ids: number[];
  earliest_at: number;
  latest_at: number;
  expand_hint?: string;
  children: DagNodeChild[];
}

interface StackFrame {
  nodeId: string;
  loading: boolean;
  error: string | null;
  detail: DagNodeDetail | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface MessageDrillModalProps {
  agentId: string;
  rootNodeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MessageDrillModal({
  agentId,
  rootNodeId,
  open,
  onOpenChange,
}: MessageDrillModalProps) {
  // Drill stack: [root, child1, child2, ...]. Top of stack is rendered.
  const [stack, setStack] = useState<StackFrame[]>([]);
  // Bumped on retry to re-trigger the fetch effect for the current top frame.
  const [retryToken, setRetryToken] = useState(0);

  // Reset stack whenever the modal is opened or the root changes. We do this
  // when transitioning from closed→open or the rootNodeId changes while open.
  const lastInitRef = useRef<{ open: boolean; rootNodeId: string } | null>(null);
  useEffect(() => {
    const last = lastInitRef.current;
    if (open) {
      if (!last || !last.open || last.rootNodeId !== rootNodeId) {
        setStack([{ nodeId: rootNodeId, loading: true, error: null, detail: null }]);
        setRetryToken(0);
      }
    } else {
      // Closed — clear stack so the next open starts fresh.
      if (last && last.open) {
        setStack([]);
      }
    }
    lastInitRef.current = { open, rootNodeId };
  }, [open, rootNodeId]);

  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  const topNodeId = top?.nodeId;
  const needsFetch =
    top !== null && top.detail === null && top.error === null && top.loading;

  /* ----- Fetch top frame on demand ------------------------------- */

  useEffect(() => {
    if (!open || !top || !needsFetch || !topNodeId) return;
    let cancelled = false;
    const targetNodeId = topNodeId;
    (async () => {
      try {
        const url = `/api/agents/${encodeURIComponent(agentId)}/lcm/nodes/${encodeURIComponent(targetNodeId)}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as DagNodeDetail;
        if (cancelled) return;
        setStack((prev) => {
          // Only patch if the top frame is still the one we fetched for.
          if (prev.length === 0) return prev;
          const idx = prev.length - 1;
          if (prev[idx].nodeId !== targetNodeId) return prev;
          const next = prev.slice();
          next[idx] = { ...next[idx], loading: false, detail: json, error: null };
          return next;
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load node";
        setStack((prev) => {
          if (prev.length === 0) return prev;
          const idx = prev.length - 1;
          if (prev[idx].nodeId !== targetNodeId) return prev;
          const next = prev.slice();
          next[idx] = { ...next[idx], loading: false, detail: null, error: message };
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally key on retryToken so retry forces a re-run.
  }, [agentId, open, needsFetch, topNodeId, retryToken]);

  /* ----- Drill / pop ------------------------------------------- */

  const drillInto = useCallback((childNodeId: string) => {
    setStack((prev) => [
      ...prev,
      { nodeId: childNodeId, loading: true, error: null, detail: null },
    ]);
  }, []);

  const popFrame = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const retry = useCallback(() => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const idx = prev.length - 1;
      const next = prev.slice();
      next[idx] = { ...next[idx], loading: true, error: null, detail: null };
      return next;
    });
    setRetryToken((t) => t + 1);
  }, []);

  /* ----- Breadcrumb -------------------------------------------- */

  const breadcrumb = useMemo(
    () => stack.map((f) => f.nodeId.slice(0, 8)).join(" / "),
    [stack],
  );

  /* ----- Render ------------------------------------------------- */

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="message-drill-modal"
        className="max-w-[760px] gap-0 border-0 p-0"
        style={{
          background: "var(--oc-bg1)",
          color: "var(--color-foreground)",
          maxHeight: "85vh",
        }}
        // Use our own close button — hide the default one by scoping its style.
        onPointerDownOutside={(e) => {
          // Allow click-outside-to-close.
          void e;
        }}
      >
        <span className="sr-only">
          <DialogTitle>Source messages for D0 node</DialogTitle>
          <DialogDescription>
            Byte-exact source messages recovered from the LCM compressed history.
          </DialogDescription>
        </span>

        {/* Header */}
        <div
          className="flex items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--oc-border)" }}
        >
          {stack.length > 1 && (
            <button
              type="button"
              onClick={popFrame}
              className="flex h-7 items-center gap-1 rounded-[4px] border px-2 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)]"
              style={{
                borderColor: "var(--oc-border)",
                color: "var(--oc-text-dim)",
              }}
              data-testid="message-drill-back"
              aria-label="Back"
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </button>
          )}
          <span
            className="text-[12px] font-medium"
            style={{ color: "var(--color-foreground)" }}
            data-testid="message-drill-header"
          >
            {top?.detail?.source_type === "messages" || top?.detail?.depth === 0
              ? "Source messages for D0 node"
              : "DAG node detail"}
          </span>
          {stack.length > 1 && (
            <span
              className="ml-2 truncate text-[10.5px]"
              style={{
                color: "var(--oc-text-muted)",
                fontFamily: "var(--oc-mono)",
              }}
              data-testid="message-drill-breadcrumb"
              title={stack.map((f) => f.nodeId).join(" / ")}
            >
              {breadcrumb}
            </span>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-[4px] transition-colors hover:bg-[var(--oc-bg2)]"
            style={{ color: "var(--oc-text-muted)" }}
            data-testid="message-drill-close"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div
          className="flex-1 overflow-auto p-4"
          style={{ maxHeight: "calc(85vh - 56px)" }}
        >
          {top && top.loading && (
            <div
              className="flex items-center gap-2 text-[12px]"
              style={{ color: "var(--oc-text-muted)" }}
              data-testid="message-drill-loading"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading node detail…
            </div>
          )}

          {top && !top.loading && top.error && (
            <div
              className="flex flex-col gap-2"
              data-testid="message-drill-error"
              role="alert"
            >
              <div
                className="flex items-start gap-2 rounded border p-3 text-[11.5px]"
                style={{
                  background: "var(--oc-bg2)",
                  borderColor: "rgba(248,113,113,0.35)",
                  color: "#f87171",
                }}
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>Failed to load: {top.error}</span>
              </div>
              <button
                type="button"
                onClick={retry}
                className="self-start rounded-[4px] border px-3 py-1 text-[11.5px] transition-colors hover:bg-[var(--oc-bg2)]"
                style={{
                  borderColor: "var(--oc-border)",
                  color: "var(--oc-text-dim)",
                }}
                data-testid="message-drill-retry"
              >
                Retry
              </button>
            </div>
          )}

          {top && !top.loading && top.detail && (
            <FrameView detail={top.detail} onDrillInto={drillInto} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Subcomponents                                                      */
/* ------------------------------------------------------------------ */

function FrameView({
  detail,
  onDrillInto,
}: {
  detail: DagNodeDetail;
  onDrillInto: (nodeId: string) => void;
}) {
  const isMessages = detail.source_type === "messages";

  return (
    <div className="flex flex-col gap-3">
      {/* Metadata strip */}
      <div
        className="flex flex-wrap items-center gap-2 rounded border p-2.5 text-[11px]"
        style={{
          background: "var(--oc-bg2)",
          borderColor: "var(--oc-border)",
          color: "var(--oc-text-muted)",
          fontFamily: "var(--oc-mono)",
        }}
        data-testid="message-drill-metadata"
      >
        <span
          className="rounded-[3px] px-1.5 py-0.5"
          style={{
            background: detail.depth === 0 ? "var(--oc-bg1)" : "var(--oc-accent-soft, var(--oc-bg1))",
            color: "var(--oc-text-dim)",
            fontWeight: 600,
          }}
        >
          D{detail.depth}
        </span>
        <span>·</span>
        <span>{detail.token_count} tok summary</span>
        <span>·</span>
        <span>{detail.source_token_count} tok source</span>
        <span>·</span>
        <span>
          {new Date(detail.earliest_at * 1000).toLocaleString()} —{" "}
          {new Date(detail.latest_at * 1000).toLocaleString()}
        </span>
      </div>

      {/* Summary preview */}
      <div>
        <div
          className="mb-1 text-[10px] uppercase tracking-[0.5px]"
          style={{ color: "var(--oc-text-muted)" }}
        >
          Summary
        </div>
        <div
          className="whitespace-pre-wrap rounded border p-2.5 text-[12px] leading-relaxed"
          style={{
            background: "var(--oc-bg2)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
          }}
        >
          {detail.summary}
        </div>
        {detail.expand_hint && (
          <div
            className="mt-1.5 text-[11px] italic"
            style={{ color: "var(--oc-text-dim)" }}
          >
            {detail.expand_hint}
          </div>
        )}
      </div>

      {isMessages ? (
        <>
          {/* Lossless verified chip */}
          <div
            className="flex items-center gap-2 self-start rounded-full border px-2.5 py-1 text-[11px]"
            style={{
              background: "rgba(34,197,94,0.08)",
              borderColor: "rgba(34,197,94,0.35)",
              color: "#4ade80",
            }}
            data-testid="message-drill-lossless-chip"
          >
            <CheckCircle2 className="h-3 w-3" />
            <span>
              Lossless verified · {detail.children.length}{" "}
              {detail.children.length === 1 ? "message" : "messages"} recovered
              {" · "}
              {detail.source_token_count} tok
            </span>
          </div>

          {/* Raw message list */}
          <div
            className="flex flex-col gap-2.5"
            data-testid="message-drill-list"
          >
            {detail.children.map((c, i) =>
              c.kind === "message" ? (
                <RawMessageRow key={`${c.store_id}-${i}`} m={c} />
              ) : null,
            )}
          </div>
        </>
      ) : (
        // D1+ children list
        <div className="flex flex-col gap-2" data-testid="message-drill-children">
          <div
            className="text-[10px] uppercase tracking-[0.5px]"
            style={{ color: "var(--oc-text-muted)" }}
          >
            {detail.children.length}{" "}
            {detail.children.length === 1 ? "child node" : "child nodes"}
          </div>
          {detail.children.map((c) =>
            c.kind === "node" ? (
              <ChildNodeRow
                key={c.node_id}
                child={c}
                onClick={() => onDrillInto(c.node_id)}
              />
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function RawMessageRow({ m }: { m: DagNodeChildMessage }) {
  const isUser = m.role === "user";
  return (
    <div
      className="rounded border p-3"
      style={{
        background: isUser ? "var(--oc-accent-soft, var(--oc-bg2))" : "var(--oc-bg2)",
        borderColor: isUser ? "var(--oc-accent-ring, var(--oc-border))" : "var(--oc-border)",
      }}
      data-testid={`message-drill-row-${m.store_id}`}
    >
      <div
        className="mb-1 flex items-center gap-2 text-[10.5px]"
        style={{
          color: "var(--oc-text-muted)",
          fontFamily: "var(--oc-mono)",
        }}
      >
        <span style={{ fontWeight: 600 }}>{m.role}</span>
        <span>·</span>
        <span>{m.source}</span>
        <span>·</span>
        <span>#{m.store_id}</span>
        <span>·</span>
        <span>{new Date(m.ts * 1000).toLocaleString()}</span>
      </div>
      <div
        className="whitespace-pre-wrap text-[12.5px] leading-relaxed"
        style={{ color: "var(--color-foreground)" }}
      >
        {m.content}
      </div>
    </div>
  );
}

function ChildNodeRow({
  child,
  onClick,
}: {
  child: DagNodeChildNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-1.5 rounded border p-2.5 text-left transition-colors hover:bg-[var(--oc-bg1)]"
      style={{
        background: "var(--oc-bg2)",
        borderColor: "var(--oc-border)",
      }}
      data-testid={`message-drill-child-${child.node_id}`}
    >
      <div
        className="flex items-center gap-2 text-[10.5px]"
        style={{
          color: "var(--oc-text-muted)",
          fontFamily: "var(--oc-mono)",
        }}
      >
        <span
          className="rounded-[3px] px-1.5 py-0.5"
          style={{
            background: "var(--oc-bg1)",
            color: "var(--oc-text-dim)",
            fontWeight: 600,
          }}
        >
          D{child.depth}
        </span>
        <span className="truncate">{child.node_id}</span>
        <span>·</span>
        <span>{child.child_count} src</span>
        <ChevronRight
          className="ml-auto h-3 w-3"
          style={{ color: "var(--oc-text-muted)" }}
        />
      </div>
      <div
        className="text-[11.5px]"
        style={{
          color: "var(--oc-text-dim)",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {child.summary_preview}
      </div>
    </button>
  );
}

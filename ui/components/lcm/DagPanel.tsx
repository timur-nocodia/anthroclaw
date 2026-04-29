"use client";

/**
 * Plan 3 Task B3 — DAG visualizer panel for the session inspector.
 *
 * Self-contained right-rail component:
 *   - Fetches /api/agents/[agentId]/lcm/dag?session=[sessionId] on mount.
 *   - Hides itself entirely when there's no LCM data (empty `nodes` array).
 *   - Renders depth-grouped collapsible sections (D{maxDepth}…D0).
 *   - Per-node click: lazy-fetches /lcm/nodes/[nodeId] and shows full
 *     summary + children inline.
 *   - Search bar: hits /lcm/grep?q=...&session=...&limit=10 on submit;
 *     renders a flat hit list above the tree.
 *
 * On API error during initial mount we surface the error inline (no silent
 * hide), so an operator can distinguish "no data yet" from "broken".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Network,
  Loader2,
  AlertCircle,
  X,
} from "lucide-react";

import { MessageDrillModal } from "./MessageDrillModal";

/* ------------------------------------------------------------------ */
/*  Types — mirror API shapes                                          */
/* ------------------------------------------------------------------ */

interface DagNodeSummary {
  node_id: string;
  session_id: string;
  depth: number;
  summary: string;
  token_count: number;
  source_token_count: number;
  earliest_at: number;
  latest_at: number;
  expand_hint?: string;
  child_count: number;
}

interface DagListResponse {
  agentId: string;
  session: string | null;
  depth: number | null;
  totalSessions: number;
  totalNodes: number;
  countsByDepth: Record<number, number>;
  nodes: DagNodeSummary[];
}

type GrepHit =
  | {
      kind: "message";
      store_id: number;
      session_id: string;
      source: string;
      role: string;
      ts: number;
      snippet: string;
      rank: number;
    }
  | {
      kind: "node";
      node_id: string;
      session_id: string;
      depth: number;
      snippet: string;
      rank: number;
    };

interface GrepResponse {
  agentId: string;
  query: string;
  hits: GrepHit[];
  totalReturned: number;
  truncated: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface DagPanelProps {
  agentId: string;
  sessionId: string;
}

export function DagPanel({ agentId, sessionId }: DagPanelProps) {
  const [data, setData] = useState<DagListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [collapsed, setCollapsed] = useState(false);
  const [depthOpen, setDepthOpen] = useState<Record<number, boolean>>({});
  // Track which node opened the drill modal (null = closed).
  const [drillNodeId, setDrillNodeId] = useState<string | null>(null);

  // Search state
  const [searchInput, setSearchInput] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<GrepResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  /* ----- Initial fetch ------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setData(null);
    setDrillNodeId(null);
    setSearchActive(false);
    setSearchResults(null);
    setSearchInput("");

    (async () => {
      try {
        const url = `/api/agents/${encodeURIComponent(agentId)}/lcm/dag?session=${encodeURIComponent(sessionId)}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as DagListResponse;
        if (cancelled) return;
        setData(json);
        // Default-open the highest depth (most compressed view)
        if (json.nodes.length > 0) {
          const depths = Object.keys(json.countsByDepth).map((d) => Number(d));
          const max = Math.max(...depths);
          setDepthOpen({ [max]: true });
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load DAG");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId, sessionId]);

  /* ----- Node drill (opens MessageDrillModal) -------------------- */

  const handleNodeClick = useCallback((nodeId: string) => {
    setDrillNodeId(nodeId);
  }, []);

  const handleDrillOpenChange = useCallback((open: boolean) => {
    if (!open) setDrillNodeId(null);
  }, []);

  /* ----- Search -------------------------------------------------- */

  const submitSearch = useCallback(async () => {
    const q = searchInput.trim();
    if (!q) return;
    setSearchActive(true);
    setSearchLoading(true);
    setSearchError(null);
    try {
      const url =
        `/api/agents/${encodeURIComponent(agentId)}/lcm/grep` +
        `?q=${encodeURIComponent(q)}` +
        `&session=${encodeURIComponent(sessionId)}` +
        `&limit=10`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as GrepResponse;
      setSearchResults(json);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
      setSearchResults(null);
    } finally {
      setSearchLoading(false);
    }
  }, [agentId, sessionId, searchInput]);

  const clearSearch = useCallback(() => {
    setSearchInput("");
    setSearchActive(false);
    setSearchResults(null);
    setSearchError(null);
  }, []);

  /* ----- Derived: depth groups ----------------------------------- */

  const depthGroups = useMemo(() => {
    if (!data) return [];
    const map = new Map<number, DagNodeSummary[]>();
    for (const n of data.nodes) {
      const arr = map.get(n.depth);
      if (arr) arr.push(n);
      else map.set(n.depth, [n]);
    }
    // Descending: D{max} first
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [data]);

  const maxDepth = depthGroups.length > 0 ? depthGroups[0][0] : 0;

  /* ----- Render -------------------------------------------------- */

  // Loading skeleton (only on initial mount)
  if (loading) {
    return (
      <aside
        data-testid="dag-panel"
        className="flex h-full flex-col border-l"
        style={{
          minWidth: 320,
          maxWidth: 400,
          width: 360,
          background: "var(--oc-bg1)",
          borderColor: "var(--oc-border)",
        }}
      >
        <div
          className="flex items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--oc-border)" }}
        >
          <Network className="h-3.5 w-3.5" style={{ color: "var(--oc-text-dim)" }} />
          <span
            className="text-[12px] font-medium"
            style={{ color: "var(--color-foreground)" }}
          >
            Compressed history (LCM)
          </span>
        </div>
        <div className="flex flex-col gap-2 p-4" data-testid="dag-skeleton">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 rounded animate-pulse"
              style={{ background: "var(--oc-bg2)" }}
            />
          ))}
        </div>
      </aside>
    );
  }

  // Hard-fail error: render an inline error card so operators can tell
  // "broken" from "no data". Don't crash the page; don't silently hide.
  if (loadError) {
    return (
      <aside
        data-testid="dag-panel"
        className="flex h-full flex-col border-l"
        style={{
          minWidth: 320,
          maxWidth: 400,
          width: 360,
          background: "var(--oc-bg1)",
          borderColor: "var(--oc-border)",
        }}
      >
        <div
          className="flex items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--oc-border)" }}
        >
          <Network className="h-3.5 w-3.5" style={{ color: "var(--oc-text-dim)" }} />
          <span
            className="text-[12px] font-medium"
            style={{ color: "var(--color-foreground)" }}
          >
            Compressed history (LCM)
          </span>
        </div>
        <div className="p-4" data-testid="dag-error" role="alert">
          <div
            className="flex items-start gap-2 rounded border p-3 text-[11.5px]"
            style={{
              background: "var(--oc-bg2)",
              borderColor: "rgba(248,113,113,0.35)",
              color: "#f87171",
            }}
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>Failed to load DAG: {loadError}</span>
          </div>
        </div>
      </aside>
    );
  }

  // Hide-when-empty: data fetched, but no nodes for this session.
  // Render nothing so the transcript stays full-width as it was before.
  if (!data || data.nodes.length === 0) {
    return null;
  }

  const depthCount = depthGroups.length;
  const totalNodes = data.totalNodes;

  return (
    <>
    <aside
      data-testid="dag-panel"
      className="flex h-full flex-col border-l"
      style={{
        minWidth: collapsed ? 0 : 320,
        maxWidth: collapsed ? 32 : 400,
        width: collapsed ? 32 : 360,
        background: "var(--oc-bg1)",
        borderColor: "var(--oc-border)",
        transition: "width 120ms ease, min-width 120ms ease",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 border-b px-3 py-3"
        style={{ borderColor: "var(--oc-border)" }}
      >
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[4px] transition-colors hover:bg-[var(--oc-bg2)]"
          style={{ color: "var(--oc-text-dim)" }}
          title={collapsed ? "Expand DAG panel" : "Collapse DAG panel"}
          data-testid="dag-collapse-toggle"
          aria-label={collapsed ? "Expand DAG panel" : "Collapse DAG panel"}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        {!collapsed && (
          <>
            <Network
              className="h-3.5 w-3.5 flex-shrink-0"
              style={{ color: "var(--oc-text-dim)" }}
            />
            <span
              className="flex-1 truncate text-[12px] font-medium"
              style={{ color: "var(--color-foreground)" }}
              data-testid="dag-title"
            >
              Compressed history (LCM)
            </span>
            <span
              className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px]"
              style={{
                background: "var(--oc-bg2)",
                color: "var(--oc-text-muted)",
                border: "1px solid var(--oc-border)",
              }}
              data-testid="dag-count-chip"
            >
              {totalNodes} {totalNodes === 1 ? "node" : "nodes"} across {depthCount}{" "}
              {depthCount === 1 ? "depth" : "depths"}
            </span>
          </>
        )}
      </div>

      {!collapsed && (
        <>
          {/* Search bar */}
          <div
            className="border-b px-3 py-2"
            style={{ borderColor: "var(--oc-border)" }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitSearch();
              }}
              className="flex items-center gap-1.5"
            >
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2"
                  style={{ color: "var(--oc-text-muted)" }}
                />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search DAG…"
                  className="h-7 w-full rounded-[4px] border bg-transparent pl-7 pr-2 text-[11.5px] outline-none focus:border-[var(--oc-accent)]"
                  style={{
                    background: "var(--oc-bg0)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                  }}
                  data-testid="dag-search-input"
                />
              </div>
              <button
                type="submit"
                disabled={!searchInput.trim() || searchLoading}
                className="flex h-7 items-center gap-1 rounded-[4px] border px-2 text-[11px] transition-colors hover:bg-[var(--oc-bg2)] disabled:opacity-40"
                style={{
                  borderColor: "var(--oc-border)",
                  color: "var(--oc-text-dim)",
                }}
                data-testid="dag-search-submit"
              >
                {searchLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  "Go"
                )}
              </button>
              {searchActive && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="flex h-7 w-7 items-center justify-center rounded-[4px] transition-colors hover:bg-[var(--oc-bg2)]"
                  style={{ color: "var(--oc-text-muted)" }}
                  title="Clear search"
                  data-testid="dag-search-clear"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </form>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto p-3">
            {/* Search results */}
            {searchActive && (
              <div className="mb-3" data-testid="dag-search-results">
                <div
                  className="mb-1.5 text-[10px] uppercase tracking-[0.5px]"
                  style={{ color: "var(--oc-text-muted)" }}
                >
                  Search results
                </div>
                {searchError ? (
                  <div
                    className="rounded border p-2 text-[11px]"
                    style={{
                      background: "var(--oc-bg2)",
                      borderColor: "rgba(248,113,113,0.35)",
                      color: "#f87171",
                    }}
                    role="alert"
                  >
                    {searchError}
                  </div>
                ) : searchLoading ? (
                  <div
                    className="text-[11px]"
                    style={{ color: "var(--oc-text-muted)" }}
                  >
                    Searching…
                  </div>
                ) : searchResults && searchResults.hits.length === 0 ? (
                  <div
                    className="text-[11px]"
                    style={{ color: "var(--oc-text-muted)" }}
                    data-testid="dag-search-empty"
                  >
                    No matches for &quot;{searchResults.query}&quot;
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {searchResults?.hits.map((hit, i) => (
                      <SearchHitCard key={`${hit.kind}-${i}`} hit={hit} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Depth tree */}
            <div
              className="flex flex-col gap-2"
              data-testid="dag-tree"
            >
              {depthGroups.map(([depth, nodes]) => {
                const open = !!depthOpen[depth];
                return (
                  <div key={depth} data-testid={`dag-depth-${depth}`}>
                    <button
                      onClick={() =>
                        setDepthOpen((prev) => ({ ...prev, [depth]: !open }))
                      }
                      className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[11px] transition-colors hover:bg-[var(--oc-bg2)]"
                      style={{ color: "var(--oc-text-dim)" }}
                      data-testid={`dag-depth-toggle-${depth}`}
                      aria-expanded={open}
                    >
                      {open ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      <DepthBadge depth={depth} maxDepth={maxDepth} />
                      <span style={{ color: "var(--oc-text-muted)" }}>
                        ({nodes.length})
                      </span>
                    </button>
                    {open && (
                      <div className="mt-1.5 flex flex-col gap-1.5 pl-1">
                        {nodes.map((node) => (
                          <NodeCard
                            key={node.node_id}
                            node={node}
                            maxDepth={maxDepth}
                            active={drillNodeId === node.node_id}
                            onClick={() => handleNodeClick(node.node_id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </aside>
    {drillNodeId && (
      <MessageDrillModal
        agentId={agentId}
        rootNodeId={drillNodeId}
        open={true}
        onOpenChange={handleDrillOpenChange}
      />
    )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Subcomponents                                                      */
/* ------------------------------------------------------------------ */

function DepthBadge({ depth, maxDepth }: { depth: number; maxDepth: number }) {
  // D{max} = accent, intermediate = soft accent, D0 = neutral.
  const isMax = depth === maxDepth && maxDepth > 0;
  const isZero = depth === 0;
  const bg = isMax
    ? "var(--oc-accent)"
    : isZero
      ? "var(--oc-bg2)"
      : "var(--oc-accent-soft, var(--oc-bg2))";
  const fg = isMax ? "#000" : isZero ? "var(--oc-text-muted)" : "var(--oc-text-dim)";
  return (
    <span
      className="inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        background: bg,
        color: fg,
        fontFamily: "var(--oc-mono)",
      }}
      data-testid={`dag-depth-badge-${depth}`}
    >
      D{depth}
    </span>
  );
}

interface NodeCardProps {
  node: DagNodeSummary;
  maxDepth: number;
  active: boolean;
  onClick: () => void;
}

function NodeCard({ node, maxDepth, active, onClick }: NodeCardProps) {
  return (
    <div
      className="rounded border p-2.5"
      style={{
        background: "var(--oc-bg2)",
        borderColor: active ? "var(--oc-accent)" : "var(--oc-border)",
      }}
      data-testid={`dag-node-${node.node_id}`}
    >
      <button
        onClick={onClick}
        className="flex w-full flex-col items-stretch gap-1.5 text-left"
        data-testid={`dag-node-button-${node.node_id}`}
        aria-haspopup="dialog"
      >
        <div className="flex items-center gap-1.5">
          <DepthBadge depth={node.depth} maxDepth={maxDepth} />
          <span
            className="ml-auto flex-shrink-0 text-[10px]"
            style={{
              color: "var(--oc-text-muted)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {node.token_count} tok
          </span>
        </div>
        <div
          className="line-clamp-3 text-[11.5px]"
          style={{
            color: "var(--oc-text-dim)",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {node.summary}
        </div>
        <div
          className="flex items-center gap-2 text-[10px]"
          style={{
            color: "var(--oc-text-muted)",
            fontFamily: "var(--oc-mono)",
          }}
        >
          <span>{node.child_count} src</span>
          <span>·</span>
          <span className="truncate">{node.node_id.slice(0, 12)}…</span>
        </div>
      </button>
    </div>
  );
}

function SearchHitCard({ hit }: { hit: GrepHit }) {
  const isNode = hit.kind === "node";
  return (
    <div
      className="rounded border p-2 text-[11px]"
      style={{
        background: "var(--oc-bg2)",
        borderColor: "var(--oc-border)",
        color: "var(--oc-text-dim)",
      }}
      data-testid={`dag-search-hit-${isNode ? hit.node_id : hit.store_id}`}
    >
      <div
        className="mb-0.5 flex items-center gap-1.5 text-[10px]"
        style={{
          color: "var(--oc-text-muted)",
          fontFamily: "var(--oc-mono)",
        }}
      >
        {isNode ? (
          <>
            <span>NODE</span>
            <span>·</span>
            <span>D{hit.depth}</span>
            <span>·</span>
            <span className="truncate">{hit.node_id.slice(0, 12)}…</span>
          </>
        ) : (
          <>
            <span>MSG</span>
            <span>·</span>
            <span>{hit.role}</span>
            <span>·</span>
            <span>#{hit.store_id}</span>
          </>
        )}
      </div>
      <div
        className="whitespace-pre-wrap"
        // The grep snippet contains <mark>…</mark> from FTS5 highlight().
        // We render it as text rather than HTML to avoid an XSS surface.
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {hit.snippet}
      </div>
    </div>
  );
}

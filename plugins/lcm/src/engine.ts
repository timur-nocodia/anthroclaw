/**
 * LCMEngine — Lossless Context Management orchestrator.
 *
 * Wires together MessageStore, SummaryDAG, LifecycleManager, and
 * summarizeWithEscalation into a compress/assemble pipeline.
 *
 * Design decisions:
 * - No imports from @anthropic-ai/sdk or @anthropic-ai/claude-agent-sdk.
 *   The EngineMessage type is internal; gateway adapters (T20/T21) translate.
 * - Lifecycle calls are wrapped in try/catch: the row may not exist for every
 *   agentId, and lifecycle errors must never crash compression.
 * - Assembly drops oldest D0 anchors first when over assemblyCapTokens.
 * - D2+ anchors appear before D1, D1 before D0 (highest-condensation first).
 */

import { MessageStore } from './store.js';
import type { InboundMessage } from './store.js';
import { SummaryDAG } from './dag.js';
import type { SummaryNode } from './dag.js';
import { LifecycleManager } from './lifecycle.js';
import type { LifecycleState } from './lifecycle.js';
import { summarizeWithEscalation } from './escalation.js';
import { estimateTokens } from './tokens.js';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Internal message shape — decoupled from `@anthropic-ai/claude-agent-sdk`.
 * Gateway adapters in T20/T21 will translate between SDK and EngineMessage.
 */
export interface EngineMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls_json?: string;
  tool_name?: string;
  /** unix ms; engine fills with Date.now() if missing */
  ts?: number;
}

/**
 * Resolved LCM configuration. T13 will define a Zod schema producing this
 * shape; for now the engine consumes a plain object literal with these fields.
 */
export interface ResolvedLCMConfig {
  /** Token budget per leaf chunk (D0 node). Default 2048. */
  leafChunkTokens: number;
  /** Number of D{n} nodes that condense into one D{n+1}. Default 4. */
  condensationFanin: number;
  /** Number of recent messages preserved as fresh tail. Default 6. */
  freshTailLength: number;
  /** Token cap for assembled prompt. Default 32000. */
  assemblyCapTokens: number;
  /** L3 char-truncation budget. Default 2048. */
  l3TruncateChars: number;
  /** L2 budget ratio (relative to L1). Default 0.5. */
  l2BudgetRatio: number;
  /** Enable dynamic leaf chunk doubling when raw_tokens > 2x working_chunk. Default true. */
  dynamicLeafChunk: boolean;
  /** If only one fanin group of debt remains, skip condensation. Default true. */
  cacheFriendlyCondensation: boolean;
}

export interface CompressInput {
  agentId: string;
  sessionKey: string;
  messages: EngineMessage[];
  currentTokens: number;
}

export interface CompressOutput {
  messages: EngineMessage[];
  compressionApplied: boolean;
  newNodesCreated: number;
}

export interface AssembleInput {
  agentId: string;
  sessionKey: string;
  messages: EngineMessage[];
}

export interface AssembleOutput {
  messages: EngineMessage[];
}

export interface EngineStatus {
  sessionKey: string;
  storedMessages: number;
  totalTokens: number;
  nodesAtDepth: Record<number, number>;
  lifecycle: LifecycleState | null;
}

export interface EngineDeps {
  store: MessageStore;
  dag: SummaryDAG;
  lifecycle: LifecycleManager;
  runSubagent: (opts: {
    prompt: string;
    systemPrompt?: string;
    timeoutMs?: number;
  }) => Promise<string>;
  config: ResolvedLCMConfig;
  logger: {
    info: (obj: unknown, msg: string) => void;
    warn: (obj: unknown, msg: string) => void;
    error: (obj: unknown, msg: string) => void;
    debug: (obj: unknown, msg: string) => void;
  };
}

// ─── LCMEngine ────────────────────────────────────────────────────────────────

export class LCMEngine {
  private readonly _deps: EngineDeps;

  constructor(deps: EngineDeps) {
    this._deps = deps;
  }

  // ─── ingest ───────────────────────────────────────────────────────────────

  /**
   * Persist messages into the immutable MessageStore.
   *
   * Each message is mapped to InboundMessage shape and appended.
   * The caller (T20 compressor.ts) is responsible for calling initialize()
   * on the lifecycle row before any ingest. The engine does NOT touch
   * lifecycle here — compress() updates the frontier after a successful pass.
   */
  ingest(sessionId: string, source: string, messages: EngineMessage[]): void {
    const { store, logger } = this._deps;

    for (const msg of messages) {
      const inbound: InboundMessage = {
        session_id: sessionId,
        source,
        role: msg.role,
        content: msg.content,
        tool_call_id: msg.tool_call_id,
        tool_calls_json: msg.tool_calls_json,
        tool_name: msg.tool_name,
        ts: msg.ts ?? Date.now(),
      };

      try {
        store.append(inbound);
      } catch (err) {
        logger.warn({ err: String(err) }, 'LCMEngine.ingest: failed to append message');
      }
    }
  }

  // ─── compress ─────────────────────────────────────────────────────────────

  /**
   * Main compression entry point.
   *
   * Steps:
   * 1. Bail-out if messages ≤ freshTailLength + 1 (system + fresh tail)
   * 2. Identify system msg, fresh tail, and backlog
   * 3. Dynamic leaf chunk: double effective chunk size if raw > 2x chunk
   * 4. Bail-out if backlog tokens < effective chunk size (record debt)
   * 5. Leaf pass: chunk backlog and summarize each chunk into D0 nodes
   * 6. Condensation pass: group uncondensed nodes into D{n+1} nodes
   * 7. Update lifecycle frontier and debt
   * 8. Assemble final context via this.assemble()
   */
  async compress(input: CompressInput): Promise<CompressOutput> {
    const { agentId, sessionKey, messages } = input;
    const { dag, lifecycle, config, logger } = this._deps;

    // ── 1. Bail-out check ─────────────────────────────────────────────────
    // Need at least system + at least 1 backlog msg + fresh tail
    // i.e., messages.length must be > freshTailLength + 1
    if (messages.length <= config.freshTailLength + 1) {
      logger.debug(
        { sessionKey, msgCount: messages.length, threshold: config.freshTailLength + 1 },
        'LCMEngine.compress: bail-out (not enough messages)',
      );
      this._tryRecordDebt(agentId, messages, config);
      return { messages, compressionApplied: false, newNodesCreated: 0 };
    }

    // ── 2. Identify regions ───────────────────────────────────────────────
    const systemMsg = messages[0].role === 'system' ? messages[0] : null;
    const bodyStart = systemMsg ? 1 : 0;
    const freshTailStart = Math.max(bodyStart, messages.length - config.freshTailLength);
    const freshTail = messages.slice(freshTailStart);
    const backlog = messages.slice(bodyStart, freshTailStart);

    if (backlog.length === 0) {
      this._tryRecordDebt(agentId, messages, config);
      return { messages, compressionApplied: false, newNodesCreated: 0 };
    }

    // ── 3. Dynamic leaf chunk sizing ─────────────────────────────────────
    const backlogTokens = backlog.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    let effectiveChunkTokens = config.leafChunkTokens;
    if (config.dynamicLeafChunk && backlogTokens > 2 * config.leafChunkTokens) {
      effectiveChunkTokens = config.leafChunkTokens * 2;
      logger.debug(
        { backlogTokens, effectiveChunkTokens },
        'LCMEngine.compress: doubled leaf chunk size (dynamic)',
      );
    }

    // ── 4. Bail-out if below chunk threshold ──────────────────────────────
    if (backlogTokens < effectiveChunkTokens) {
      logger.debug(
        { backlogTokens, effectiveChunkTokens },
        'LCMEngine.compress: backlog below chunk threshold — deferring',
      );
      this._tryRecordDebt(agentId, messages, config);
      return { messages, compressionApplied: false, newNodesCreated: 0 };
    }

    // ── 5. Leaf pass ──────────────────────────────────────────────────────
    let newNodesCreated = 0;
    let lastBacklogStoreId = 0;

    // Load all stored messages for this session once (for store_id mapping)
    const allStored = this._deps.store.listSession(sessionKey);
    // Shared scan cursor across chunks — ensures each chunk maps to distinct store_ids
    let storeScanCursor = 0;

    const chunks = this._chunkBacklog(backlog, effectiveChunkTokens);

    for (const chunk of chunks) {
      const sourceStr = this._serializeMessages(chunk.messages);
      const sourceTokenCount = chunk.tokenCount;
      const l1TokenBudget = Math.max(100, Math.floor(config.leafChunkTokens / 4));

      let summary: string;
      try {
        const result = await summarizeWithEscalation({
          source: sourceStr,
          l1TokenBudget,
          l3TruncateChars: config.l3TruncateChars,
          l2BudgetRatio: config.l2BudgetRatio,
          runSubagent: this._deps.runSubagent,
          logger: {
            warn: (obj, msg) => logger.warn(obj, msg),
            debug: (obj, msg) => logger.debug(obj, msg),
          },
        });
        summary = result.summary;
      } catch (err) {
        logger.error(
          { err: String(err) },
          'LCMEngine.compress: summarizeWithEscalation threw unexpectedly',
        );
        summary = sourceStr.slice(0, config.l3TruncateChars);
      }

      // Map chunk messages to store_ids using the shared cursor
      const { storeIds, nextCursor } = this._getStoreIdsWithCursor(
        chunk.messages,
        allStored,
        storeScanCursor,
      );
      storeScanCursor = nextCursor;

      const earliest = chunk.messages.reduce(
        (min, m) => Math.min(min, m.ts ?? Date.now()),
        Infinity,
      );
      const latest = chunk.messages.reduce(
        (max, m) => Math.max(max, m.ts ?? 0),
        0,
      );

      dag.create({
        session_id: sessionKey,
        depth: 0,
        summary,
        token_count: estimateTokens(summary),
        source_token_count: sourceTokenCount,
        source_ids: storeIds,
        source_type: 'messages',
        earliest_at: isFinite(earliest) ? earliest : Date.now(),
        latest_at: latest > 0 ? latest : Date.now(),
        expand_hint: this._extractExpandHint(summary),
      });

      newNodesCreated++;

      if (storeIds.length > 0) {
        lastBacklogStoreId = Math.max(lastBacklogStoreId, ...storeIds);
      }

      logger.debug(
        { depth: 0, storeIds: storeIds.length, sourceTokenCount },
        'LCMEngine.compress: created D0 node',
      );
    }

    // ── 6. Condensation pass ──────────────────────────────────────────────
    newNodesCreated += await this._condense(sessionKey, newNodesCreated > 0);

    // ── 7. Lifecycle updates ──────────────────────────────────────────────
    // After successful compression, debt is cleared (all backlog was compacted).
    try {
      lifecycle.clearDebt(agentId);
    } catch (err) {
      logger.warn(
        { agentId, err: String(err) },
        'LCMEngine.compress: could not clear lifecycle debt (row may not exist)',
      );
    }

    // Update frontier: record highest store_id compacted
    if (lastBacklogStoreId > 0) {
      try {
        lifecycle.recordCompactedFrontier(agentId, lastBacklogStoreId);
        logger.debug(
          { agentId, lastBacklogStoreId },
          'LCMEngine.compress: updated lifecycle frontier',
        );
      } catch (err) {
        logger.warn(
          { agentId, err: String(err) },
          'LCMEngine.compress: could not update lifecycle frontier (row may not exist)',
        );
      }
    }

    // ── 8. Assemble final context ─────────────────────────────────────────
    const assembleResult = await this.assemble({ agentId, sessionKey, messages });

    return {
      messages: assembleResult.messages,
      compressionApplied: true,
      newNodesCreated,
    };
  }

  // ─── assemble ─────────────────────────────────────────────────────────────

  /**
   * Assemble the active context from DAG summaries + fresh tail.
   *
   * Structure of output:
   *   [system prompt]
   *   [anchor blocks — highest depth first, then lower (D2 → D1 → D0)]
   *   [fresh tail messages]
   *
   * When no DAG nodes exist for the session, the input messages are returned
   * unchanged (pass-through).
   *
   * If total tokens > assemblyCapTokens, the OLDEST D0 anchors are dropped
   * first (they are the least condensed and most numerous).
   */
  async assemble(input: AssembleInput): Promise<AssembleOutput> {
    const { sessionKey, messages } = input;
    const { dag, config, logger } = this._deps;

    // Check if any DAG nodes exist for this session
    const nodesByDepth = dag.countByDepth(sessionKey);
    const depths = Object.keys(nodesByDepth).map(Number);

    if (depths.length === 0) {
      // Pass-through: no DAG nodes
      return { messages };
    }

    const systemMsg = messages[0]?.role === 'system' ? messages[0] : null;
    const bodyStart = systemMsg ? 1 : 0;
    const freshTailStart = Math.max(bodyStart, messages.length - config.freshTailLength);
    const freshTail = messages.slice(freshTailStart);

    // Collect anchor blocks, highest depth first (D2 → D1 → D0)
    const sortedDepths = [...depths].sort((a, b) => b - a); // descending
    interface AnchorBlock {
      content: string;
      depth: number;
      createdAt: number;
    }
    const anchorBlocks: AnchorBlock[] = [];

    for (const depth of sortedDepths) {
      const nodes = dag.getNodesAtDepth(sessionKey, depth);
      for (const node of nodes) {
        const shortId = node.node_id.slice(0, 8);
        const block = `[Summary (D${depth}, node ${shortId})]\n${node.summary}`;
        anchorBlocks.push({ content: block, depth, createdAt: node.created_at });
      }
    }

    if (anchorBlocks.length === 0) {
      return { messages };
    }

    // Compute token usage for system + fresh tail
    const systemTokens = systemMsg ? estimateTokens(systemMsg.content) : 0;
    const freshTailTokens = freshTail.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const baseTokens = systemTokens + freshTailTokens;

    // Apply assembly cap: drop oldest D0 anchors first if over budget
    // Drop order: lowest depth (D0) oldest first, then older D1s, etc.
    const dropSorted = [...anchorBlocks].sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth; // lowest depth (D0) first
      return a.createdAt - b.createdAt; // oldest first within same depth
    });

    let anchorTokenTotal = anchorBlocks.reduce(
      (sum, b) => sum + estimateTokens(b.content),
      0,
    );
    let totalTokens = baseTokens + anchorTokenTotal;

    const keepSet = new Set(anchorBlocks.map(b => b));
    if (totalTokens > config.assemblyCapTokens) {
      for (const candidate of dropSorted) {
        if (totalTokens <= config.assemblyCapTokens) break;
        const candidateTokens = estimateTokens(candidate.content);
        totalTokens -= candidateTokens;
        keepSet.delete(candidate);
      }
      logger.debug(
        { sessionKey, kept: keepSet.size, totalTokens },
        'LCMEngine.assemble: trimmed anchors to fit assemblyCapTokens',
      );
    }

    // Build result: system + anchors (highest-depth first as collected) + fresh tail
    const result: EngineMessage[] = [];
    if (systemMsg) result.push(systemMsg);

    for (const block of anchorBlocks) {
      if (keepSet.has(block)) {
        result.push({ role: 'system', content: block.content });
      }
    }

    result.push(...freshTail);

    return { messages: result };
  }

  // ─── getStatus ────────────────────────────────────────────────────────────

  /**
   * Return engine status for a session.
   *
   * Note: lifecycle field is always null in T9. T20 will integrate the full
   * lifecycle state by passing agentId through a different mechanism.
   */
  getStatus(sessionKey: string): EngineStatus {
    const { store, dag } = this._deps;

    const storedMessages = store.countInSession(sessionKey);
    const allMessages = store.listSession(sessionKey);
    const totalTokens = allMessages.reduce((sum, m) => sum + m.token_estimate, 0);
    const nodesAtDepth = dag.countByDepth(sessionKey);

    return {
      sessionKey,
      storedMessages,
      totalTokens,
      nodesAtDepth,
      lifecycle: null, // T20 will integrate
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Chunk the backlog into groups of messages not exceeding the token budget.
   * Returns chunks in order (oldest first).
   */
  private _chunkBacklog(
    messages: EngineMessage[],
    maxChunkTokens: number,
  ): Array<{ messages: EngineMessage[]; tokenCount: number }> {
    const chunks: Array<{ messages: EngineMessage[]; tokenCount: number }> = [];
    let current: EngineMessage[] = [];
    let currentTokens = 0;

    for (const msg of messages) {
      const msgTokens = estimateTokens(msg.content);
      // If adding this message would exceed the budget AND we have some already, flush
      if (currentTokens + msgTokens > maxChunkTokens && current.length > 0) {
        chunks.push({ messages: current, tokenCount: currentTokens });
        current = [];
        currentTokens = 0;
      }
      current.push(msg);
      currentTokens += msgTokens;
    }

    if (current.length > 0) {
      chunks.push({ messages: current, tokenCount: currentTokens });
    }

    return chunks;
  }

  /**
   * Serialize messages to labeled text for the summarizer.
   * Format: "[ROLE]: content" per message, joined by "\n\n".
   */
  private _serializeMessages(messages: EngineMessage[]): string {
    return messages
      .map(m => {
        const roleLabel = m.role.toUpperCase();
        let content = m.content;
        if (m.tool_name) {
          content = `[Tool: ${m.tool_name}] ${content}`;
        }
        return `[${roleLabel}]: ${content}`;
      })
      .join('\n\n');
  }

  /**
   * Map messages to store_ids using a shared scan cursor.
   * The cursor advances across calls, ensuring each message in each chunk
   * maps to a distinct store entry (lossless drill-down invariant).
   *
   * @param messages - The chunk messages to map
   * @param allStored - All stored messages for this session (from listSession)
   * @param startCursor - The store index to start scanning from
   * @returns storeIds array and the next cursor position
   */
  private _getStoreIdsWithCursor(
    messages: EngineMessage[],
    allStored: Array<{ store_id: number; role: string; content: string }>,
    startCursor: number,
  ): { storeIds: number[]; nextCursor: number } {
    const ids: number[] = [];
    let storeIdx = startCursor;

    for (const msg of messages) {
      let found = false;
      const scanFrom = storeIdx;
      while (storeIdx < allStored.length) {
        const s = allStored[storeIdx];
        if (s.role === msg.role && s.content === msg.content) {
          ids.push(s.store_id);
          storeIdx++;
          found = true;
          break;
        }
        storeIdx++;
      }
      if (!found) {
        // Message not found in store — may be a synthetic message; skip
        // Reset scan to where we started this message to avoid skipping entries
        storeIdx = scanFrom;
        this._deps.logger.debug(
          { role: msg.role, contentLen: msg.content.length },
          'LCMEngine._getStoreIdsWithCursor: message not found in store (synthetic?)',
        );
      }
    }

    return { storeIds: ids, nextCursor: storeIdx };
  }

  /**
   * Run the condensation pass for a given session.
   *
   * For each depth d (starting at 0, up to 10):
   *   - Get uncondensed nodes at depth d
   *   - If count >= condensationFanin, group into full batches of exactly fanin
   *   - Apply cacheFriendlyCondensation: if leafCompactedThisTurn and only 1 batch → skip
   *   - For each batch: summarize → create D(d+1) node
   *
   * Returns the count of new nodes created.
   */
  private async _condense(sessionKey: string, leafCompactedThisTurn: boolean): Promise<number> {
    const { dag, config, logger } = this._deps;
    let newNodes = 0;

    for (let depth = 0; depth <= 10; depth++) {
      const uncondensed = dag.getUncondensedAtDepth(sessionKey, depth);

      if (uncondensed.length < config.condensationFanin) {
        // If depth > 0 and no nodes at this depth at all, we can stop
        if (depth > 0 && dag.getNodesAtDepth(sessionKey, depth).length === 0) break;
        continue;
      }

      // Build full batches only (don't create partial batches)
      const batches: SummaryNode[][] = [];
      for (let i = 0; i + config.condensationFanin <= uncondensed.length; i += config.condensationFanin) {
        batches.push(uncondensed.slice(i, i + config.condensationFanin));
      }

      if (batches.length === 0) continue;

      // cacheFriendlyCondensation: skip when leaf pass just ran AND only 1 full batch
      if (config.cacheFriendlyCondensation && leafCompactedThisTurn && batches.length === 1) {
        logger.debug(
          { sessionKey, depth, uncondensedCount: uncondensed.length },
          'LCMEngine._condense: skipping single-group condensation (cache-friendly mode)',
        );
        continue;
      }

      for (const batch of batches) {
        const combinedText = batch.map(n => n.summary).join('\n\n---\n\n');
        const sourceTokens = batch.reduce((sum, n) => sum + n.token_count, 0);
        const l1TokenBudget = Math.max(100, Math.floor(sourceTokens * 0.4));

        let summary: string;
        try {
          const result = await summarizeWithEscalation({
            source: combinedText,
            l1TokenBudget,
            l3TruncateChars: config.l3TruncateChars,
            l2BudgetRatio: config.l2BudgetRatio,
            runSubagent: this._deps.runSubagent,
            logger: {
              warn: (obj, msg) => logger.warn(obj, msg),
              debug: (obj, msg) => logger.debug(obj, msg),
            },
          });
          summary = result.summary;
        } catch (err) {
          logger.error(
            { err: String(err), depth, batchSize: batch.length },
            'LCMEngine._condense: summarizeWithEscalation threw unexpectedly',
          );
          summary = combinedText.slice(0, config.l3TruncateChars);
        }

        const earliest = batch.reduce((min, n) => Math.min(min, n.earliest_at), Infinity);
        const latest = batch.reduce((max, n) => Math.max(max, n.latest_at), 0);

        dag.create({
          session_id: sessionKey,
          depth: depth + 1,
          summary,
          token_count: estimateTokens(summary),
          source_token_count: sourceTokens,
          source_ids: batch.map(n => n.node_id),
          source_type: 'nodes',
          earliest_at: isFinite(earliest) ? earliest : Date.now(),
          latest_at: latest > 0 ? latest : Date.now(),
          expand_hint: this._extractExpandHint(summary),
        });

        newNodes++;
        logger.debug(
          { depth: depth + 1, batchSize: batch.length },
          'LCMEngine._condense: created condensation node',
        );
      }
    }

    return newNodes;
  }

  /**
   * Try to record 'raw_backlog' debt when backlog chars > 0.
   * Wrapped in try/catch — lifecycle row may not exist.
   */
  private _tryRecordDebt(
    agentId: string,
    messages: EngineMessage[],
    config: ResolvedLCMConfig,
  ): void {
    const { lifecycle, logger } = this._deps;

    try {
      const bodyStart = messages[0]?.role === 'system' ? 1 : 0;
      const freshTailStart = Math.max(bodyStart, messages.length - config.freshTailLength);
      const backlog = messages.slice(bodyStart, freshTailStart);

      if (backlog.length === 0) {
        lifecycle.clearDebt(agentId);
        return;
      }

      const backlogChars = backlog.reduce((sum, m) => sum + m.content.length, 0);
      if (backlogChars > 0) {
        lifecycle.recordDebt(agentId, 'raw_backlog', backlogChars);
      } else {
        lifecycle.clearDebt(agentId);
      }
    } catch (err) {
      logger.warn(
        { agentId, err: String(err) },
        'LCMEngine._tryRecordDebt: lifecycle row not found or error — skipping',
      );
    }
  }

  /**
   * Extract a short expand hint from a summary (first sentence, max 100 chars).
   */
  private _extractExpandHint(summary: string): string | undefined {
    if (!summary) return undefined;
    const firstSentence = summary.split(/[.!?]/)[0]?.trim();
    if (firstSentence && firstSentence.length > 0) {
      return firstSentence.slice(0, 100);
    }
    return summary.slice(0, 100);
  }
}

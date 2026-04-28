import type { LCMEngine, EngineMessage, ResolvedLCMConfig } from '../engine.js';

export interface Logger {
  info: (obj: unknown, msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
  error: (obj: unknown, msg: string) => void;
  debug: (obj: unknown, msg: string) => void;
}

/**
 * Configuration for mirror hook (subset of ResolvedLCMConfig — only mirror-relevant fields).
 * Passing the full ResolvedLCMConfig is fine; we use just `ignoreSessionPatterns` here.
 */
export interface MirrorConfig {
  ignoreSessionPatterns?: string[]; // glob-like patterns; sessionKey matching any pattern is skipped
}

export interface MirrorDeps {
  engine: LCMEngine;
  config: ResolvedLCMConfig | MirrorConfig;
  logger: Logger;
}

export interface MirrorPayload {
  agentId: string;
  sessionKey: string;
  source: string;
  newMessages: EngineMessage[];
}

/**
 * Returns a hook handler suitable for `gateway.on_after_query`. The handler:
 * - Reads agentId, sessionKey, source, newMessages from payload
 * - If newMessages is empty/missing or sessionKey matches ignoreSessionPatterns → no-op
 * - Otherwise calls engine.ingest(sessionKey, source, newMessages)
 * - NEVER throws: errors are caught and logged via logger.warn
 *
 * The handler is synchronous (engine.ingest is sync). Gateway calls it via void emitter.emit.
 */
export function createMirrorHook(deps: MirrorDeps): (payload: Record<string, unknown>) => void {
  const ignorePatterns = compilePatterns(
    (deps.config as { ignoreSessionPatterns?: string[] }).ignoreSessionPatterns ?? [],
  );

  return (raw: Record<string, unknown>) => {
    try {
      const payload = (raw ?? {}) as Partial<MirrorPayload>;
      const sessionKey = payload.sessionKey;
      const source = (payload.source as string | undefined) ?? 'unknown';
      const newMessages = payload.newMessages;

      if (typeof sessionKey !== 'string' || sessionKey.length === 0) {
        deps.logger.debug({ payload }, 'mirror hook: missing sessionKey, skip');
        return;
      }
      if (!Array.isArray(newMessages) || newMessages.length === 0) {
        deps.logger.debug({ sessionKey }, 'mirror hook: no newMessages, skip');
        return;
      }
      if (matchesAny(sessionKey, ignorePatterns)) {
        deps.logger.debug({ sessionKey }, 'mirror hook: ignored by pattern');
        return;
      }
      deps.engine.ingest(sessionKey, source, newMessages as EngineMessage[]);
    } catch (err) {
      deps.logger.warn(
        { err: String(err) },
        'mirror hook failed (swallowed to avoid breaking gateway)',
      );
    }
  };
}

// ─── Pattern helpers ──────────────────────────────────────────────────────────

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map(p => globToRegex(p));
}

/**
 * Convert a glob pattern (* and ?) to a regex anchored at both ends.
 * All other regex special characters are escaped first.
 */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function matchesAny(key: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(key));
}

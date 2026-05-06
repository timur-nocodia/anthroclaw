import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * One row of the credential audit log. Records access METADATA only.
 *
 * **MUST NOT** carry credential values. Adding `accessToken`, `refreshToken`,
 * or any field that contains secret material would defeat the purpose of the
 * log (which lives at `data/credential-access.jsonl` with mode `0o640`).
 *
 * The shape is intentionally narrow so a TypeScript reviewer can spot a
 * field-bag violation in code review.
 */
export interface CredentialAuditEvent {
  /** Wall-clock timestamp in epoch milliseconds. */
  ts: number;
  /** Agent that initiated the credential operation. */
  agentId: string;
  /** Service identifier (e.g. `'google_calendar'`, `'notion'`). */
  service: string;
  /** What was attempted on the credential. */
  action: 'get' | 'set' | 'delete';
  /**
   * Free-text rationale supplied by the caller (e.g.
   * `'mcp_call:google_calendar.list_events'`). Not validated.
   */
  reason?: string;
  /** SDK session id when known — useful for cross-referencing transcripts. */
  sessionId?: string;
}

/**
 * Append-only credential access log written as JSONL to
 * `<OC_DATA_DIR or 'data'>/credential-access.jsonl` (or a path supplied at
 * construction).
 *
 * **Atomicity.** Concurrent `record()` calls are serialized through a
 * promise chain so each line lands whole — no interleaving inside a single
 * process. Cross-process atomicity is not provided; the gateway runs as a
 * single Node process per container, so this is sufficient.
 *
 * **Failure recovery.** If one `record()` write fails, the chain is repaired
 * so subsequent records still attempt their writes. The caller's promise
 * still rejects with the original error so the failure is visible.
 */
export class CredentialAuditLog {
  private readonly path: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(path?: string) {
    this.path =
      path ?? resolve(process.env.OC_DATA_DIR ?? 'data', 'credential-access.jsonl');
  }

  async record(ev: CredentialAuditEvent): Promise<void> {
    const line = JSON.stringify(ev) + '\n';
    const prior = this.writeChain;
    const myWrite = prior.then(
      () => this.appendLine(line),
      () => this.appendLine(line),
    );
    this.writeChain = myWrite.catch(() => undefined);
    return myWrite;
  }

  private async appendLine(line: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, line, { mode: 0o640 });
  }
}

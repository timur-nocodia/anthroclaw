/**
 * Per-agent credential storage primitives.
 *
 * v0.8.0 ships only the interface (and a filesystem-backed implementation
 * in `EncryptedFilesystemCredentialStore`). v0.9.0 layers the agent-driven
 * OAuth chat flow on top of this interface — that work intentionally stays
 * out of v0.8.0 to keep the cutoff PR auditable.
 *
 * Tech-debt note: the interface is shaped so a future Vault-backed store
 * can be dropped in without changes to callers (see `docs/tech-debt.md`).
 */

/**
 * A stored OAuth credential. Returned by `CredentialStore.get`.
 *
 * `accessToken` and `refreshToken` are present here (the whole point of
 * `get`). For listing purposes, callers should use `CredentialStore.list`,
 * which returns `CredentialMetadata` — same shape minus the token fields.
 */
export interface OAuthCredential {
  /**
   * Service identifier — string-keyed so new providers can be added without
   * a type change. Conventional values: `'google_calendar'`, `'gmail'`,
   * `'notion'`, `'linear'`. See Task 8 for the full naming scheme.
   */
  service: string;
  /**
   * Account identifier within the service (typically email or username).
   * Surfaced to the agent via the metadata side-channel so it can disambiguate
   * when an agent connects multiple accounts of the same service.
   */
  account: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
  /** Array of OAuth scope strings exactly as the provider issued them. */
  scopes: string[];
  /** Free-form provider-issued metadata (e.g. profile fields). Never secrets. */
  metadata?: Record<string, string>;
}

/**
 * Credential for an MCP server reachable over HTTP/SSE that authenticates via
 * OAuth — i.e. the AnthroClaw gateway performed an OAuth dance with the
 * remote server and is now holding the resulting tokens. `mcpUrl` is part of
 * the stored record so the preflight resolver can match a `credential_ref`
 * back to the exact server URL the agent's YAML declared.
 */
export interface McpOAuthCredential {
  kind: 'mcp_oauth';
  service: string;
  account: string;
  scopes: string[];
  metadata?: Record<string, string>;
  mcpUrl: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint?: string;
  authorizationServer?: string;
  clientId?: string;
  clientSecret?: string;
  createdAt: number;
  lastRefreshAt?: number;
}

/**
 * Credential for an MCP server that authenticates via a static API key /
 * bearer token. `scheme` is the HTTP auth scheme the gateway should send
 * (`Bearer` by default for most modern servers; some use `Token`).
 */
export interface McpApiKeyCredential {
  kind: 'mcp_apikey';
  service: string;
  account: string;
  scopes: string[];
  metadata?: Record<string, string>;
  mcpUrl: string;
  token: string;
  scheme?: 'Bearer' | 'Token' | string;
  createdAt: number;
}

/**
 * Discriminated union of every credential variant the store may hold.
 *
 * Legacy `OAuthCredential` records pre-date the `kind` discriminator. On read
 * the store backfills `kind: 'oauth'` so callers can rely on the discriminator
 * without a migration step.
 */
export type StoredCredential =
  | (OAuthCredential & { kind?: 'oauth' })
  | McpOAuthCredential
  | McpApiKeyCredential;

/** Compound key used to address a credential record. */
export interface CredentialRef {
  agentId: string;
  service: string;
}

/**
 * Listing-friendly view of a credential — same shape as `OAuthCredential`
 * minus the secret fields. Returned by `CredentialStore.list` so callers
 * can render "what services has this agent connected?" without reading
 * the access tokens.
 */
export type CredentialMetadata = Omit<OAuthCredential, 'accessToken' | 'refreshToken'>;

/**
 * Per-agent credential store. Implementations are responsible for:
 *   - encrypting tokens at rest (filesystem implementation does AES-256-GCM)
 *   - emitting an audit-log entry on every `get` / `set` / `delete`
 *   - ensuring an agent cannot read another agent's credentials (the
 *     `agentId` in `CredentialRef` is the isolation boundary)
 */
export interface CredentialStore {
  /**
   * Read a credential. `accessReason` is REQUIRED free-text rationale and
   * is written to the audit log so post-hoc forensics can answer "why did
   * agent X read credential Y at time T?". Callers should embed the
   * triggering MCP call or session id when known
   * (e.g. `'mcp_call:google_calendar.list_events;session=abc123'`).
   */
  get(ref: CredentialRef, accessReason: string): Promise<StoredCredential>;
  /** Write or replace a credential. Audit log records `action: 'set'`. */
  set(ref: CredentialRef, credential: StoredCredential): Promise<void>;
  /**
   * List the agent's credentials WITHOUT exposing token material. Used by
   * the management UI and the agent's own self-introspection tools to
   * enumerate connected services.
   */
  list(agentId: string): Promise<CredentialMetadata[]>;
  /** Remove a credential. Audit log records `action: 'delete'`. */
  delete(ref: CredentialRef): Promise<void>;
}

export { CredentialAuditLog, type CredentialAuditEvent } from './audit.js';
export { loadMasterKey, MASTER_KEY_ENV } from './master-key.js';

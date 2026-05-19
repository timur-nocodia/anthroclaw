# Claude Admin Auth Flow

## Goal

Add a production-ready admin UI flow for connecting the Claude Code runtime used by AnthroClaw agents. Operators must be able to authenticate, verify, repair, and inspect legacy provider auth without entering the container or running shell commands manually.

## Requirements

- UI-only operator flow in English.
- No web terminal emulation.
- Auth must run against the same runtime home used by the app container.
- Secrets and OAuth material must never be written to logs, Git, screenshots, or API responses.
- Status must show sanitized runtime state: connected/not connected, account email when available, auth method, subscription type, runtime home, credential age, verification result.
- Flow must support starting Claude auth, opening/copying the authorization URL, submitting the returned code, verifying the connection, cancelling pending auth, and recovering from stale auth sessions.
- Runtime repair must include a controlled way to clear stale Claude subprocesses or restart the gateway runtime after credentials change.
- Tests must cover output parsing, redaction, API state transitions, and UI behavior.

## Design Direction

- Add backend API routes under `ui/app/api/claude-auth/*`.
- Wrap Claude CLI calls in a small server-side auth manager instead of exposing shell access.
- Prefer the service runtime home over root or operator host auth.
- Use short-lived in-memory auth sessions for pending OAuth flows.
- Persist only the credentials produced by the official Claude CLI in the configured runtime home.
- Avoid passing Claude subscription tokens through agent tool environments.
- Add a Settings page panel with explicit status, actions, and recovery controls.

## Verification

- Unit tests for URL/code parsing and redaction.
- API tests for start/status/complete/cancel flows using mocked CLI processes.
- Component tests for the admin panel states.
- `pnpm build`
- Targeted UI build/tests before deploy.

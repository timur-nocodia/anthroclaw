# Page: Logs

## Route
`/logs`

## Purpose
Realtime streaming log viewer. Displays pino stdout from the Gateway process.

## Data Source
- `GET /api/logs/stream?level={level}&agent={agent}` — SSE stream of `LogEntry` objects

## Behavior

### Connection
- On page load: open SSE connection to `/api/logs/stream`
- Logs stream in realtime
- If SSE disconnects: show "Reconnecting..." banner, auto-retry with backoff

### Log Display
Each log entry shows:
- **Timestamp** — formatted as HH:MM:SS.mmm (hours:minutes:seconds.milliseconds)
- **Level** — badge with color:
  - DEBUG: muted/dim
  - INFO: default/neutral
  - WARN: yellow/amber
  - ERROR: red
- **Source** — the component or agent name (e.g. "gateway", "telegram", "example-agent")
- **Message** — the log message text

Logs render as a monospace text stream (like a terminal), not as cards or table rows. Dense, scannable.

### Expandable Detail
- If a log entry has `data` (extra fields), clicking the row expands it to show the full JSON
- Collapsed by default

### Filters
Located at the top of the page, always visible:

- **Level filter** (select/button group): All, Debug, Info, Warn, Error
  - Selecting a level shows that level and above (e.g. "Warn" shows warn + error)
  - Default: Info (shows info, warn, error)
- **Source filter** (select): All, or specific sources (populated from seen sources)
  - Allow typing to filter the dropdown
- **Text search** (text input): client-side filter on message content
  - Filters displayed logs instantly (no API call)
  - Highlight matching text in results

Changing level or agent filter: closes current SSE, opens new one with updated query params.

### Controls
- **Pause/Resume** toggle — pauses incoming log display (buffers in background, shows count of buffered logs)
- **Clear** button — clears the displayed log buffer (does not affect the stream)
- **Jump to bottom** — floating button shown when scrolled up

### Performance
- Keep max 2000 log entries in state. When exceeding, drop oldest entries.
- Use virtualized list for rendering (only render visible rows). Library suggestion: `@tanstack/react-virtual` or similar.
- Monospace font, fixed row height for virtualization.

### Auto-scroll
- Same pattern as chat: auto-scroll to bottom on new entries
- Stop auto-scroll when user scrolls up
- Show buffered count: "47 new entries" floating button at bottom

## Empty State
"Waiting for logs..." with a subtle pulse animation. If no logs after 5 seconds, show "No log output. Is the gateway running?"

## Error State
- SSE connection failed: "Cannot connect to log stream. Is the server running?" + Retry button

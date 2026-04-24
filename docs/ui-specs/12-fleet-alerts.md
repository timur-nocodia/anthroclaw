# Component: Alerts Panel

## Trigger
Clicking "Alerts (N)" button in Fleet header. Opens as a slide-over panel or sheet from the right side.

## Data Source
- `GET /api/fleet/alerts` → list of alerts with status
- `PUT /api/fleet/alerts/{alertId}/ack` → acknowledge alert
- `GET /api/fleet/alert-rules` → configured alert rules
- `PUT /api/fleet/alert-rules` → update alert rules

## Header
- "Alerts" title
- Summary: "{N} open · {N} acknowledged"
- Close button (X)

## Filter Tabs
- **Open** (default) — unacknowledged alerts
- **Acknowledged** — acknowledged but not resolved
- **All** — everything including auto-resolved

## Alert Rules Link
"Alert rules" button/link — navigates to alert rules configuration (or opens a sub-panel).

## Alert Cards

Each alert renders as a card with colored border:

**Critical (red border):**
- Warning icon (triangle)
- "critical" badge in red
- Message: e.g. "Server offline > 14m"
- Source: server hostname + relative time (e.g. "gw-edge-br · 14m ago")
- Actions: "Ack" button (acknowledge), "Open" button (navigate to server)

**Warning (yellow border):**
- Warning icon (triangle)
- "warning" badge in yellow/amber
- Message: e.g. "SSL expires in 5 days", "Disk usage > 90%"
- Source: server hostname + relative time
- Actions: "Ack" button, "Open" button

**Info (blue border, future):**
- For non-critical notifications

## Alert Lifecycle

```
triggered → open → acknowledged → resolved (auto)
                                 ↘ resolved (manual)
```

- **Open**: New alert, needs attention
- **Acknowledged**: Someone clicked "Ack" — still visible but marked as seen
- **Resolved**: Condition cleared (e.g. server came back online, disk dropped below threshold). Auto-resolved by the system on next heartbeat check. Removed from default view after 24h.

## Built-in Alert Rules

These are the default alert conditions (configurable):

| Alert | Condition | Severity | Auto-resolve |
|-------|-----------|----------|-------------|
| Server offline | No heartbeat > 60s | critical | When heartbeat resumes |
| High CPU | CPU > 80% for 5min | warning | When CPU drops below 70% |
| High memory | MEM > 80% for 5min | warning | When MEM drops below 70% |
| High disk | DISK > 90% | warning | When DISK drops below 80% |
| Elevated P50 | P50 > 1000ms for 5min | warning | When P50 drops below 800ms |
| SSL expiring | SSL cert expires < 14 days | warning | When cert renewed |
| Channel disconnected | TG or WA channel error > 5min | warning | When channel reconnects |
| Version mismatch | Server version differs from fleet majority | info | When updated |

## Alert Rules Configuration

Accessible via "Alert rules" button. Form to configure thresholds:

| Setting | Type | Default |
|---------|------|---------|
| CPU warning threshold | percentage | 80% |
| CPU duration | minutes | 5 |
| Memory warning threshold | percentage | 80% |
| Disk warning threshold | percentage | 90% |
| P50 warning threshold | ms | 1000 |
| Offline timeout | seconds | 60 |
| SSL expiry warning | days | 14 |
| Channel disconnect timeout | minutes | 5 |

Enable/disable individual alert types via checkboxes.

## Alert Notifications (future)

Where to send alerts:
- Telegram bot message (to admin)
- Email
- Webhook URL
- Disabled (UI only)

Configured per severity level (critical → always notify, warning → configurable).

## Alert Storage
Alerts stored in `data/fleet-alerts.json`:
```json
{
  "alerts": [
    {
      "id": "a1b2c3",
      "serverId": "gw-edge-br",
      "type": "server_offline",
      "severity": "critical",
      "message": "Server offline > 14m",
      "triggeredAt": "2026-04-22T10:14:00Z",
      "acknowledgedAt": null,
      "resolvedAt": null
    }
  ],
  "rules": { ... }
}
```

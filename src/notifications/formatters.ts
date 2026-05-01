import type { NotificationEventName, NotificationEventPayload } from './types.js';

/**
 * Format a notification event for delivery on Telegram or as plain text
 * (the WhatsApp fallback). Telegram output uses the project's Markdown
 * convention: `*bold*`, `_italic_`, and `` `code` ``.
 *
 * Time formatting respects the agent's timezone when present in the
 * payload (`timezone: 'Asia/Almaty'` etc.); otherwise falls back to UTC.
 *
 * The formatters are intentionally tolerant of missing fields — events
 * are diagnostic, not contractual, and a partial payload should still
 * produce a readable message.
 */

const DEFAULT_TZ = 'UTC';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Render an ISO timestamp in the given IANA tz. Same-day → `HH:mm`,
 * older → `MM-DD HH:mm`. Treats `now` separately so tests can pin it.
 */
function formatEventTime(iso: string | undefined, tz: string, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Use Intl to get year/month/day/hour/minute in target tz.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const nowParts = fmt.formatToParts(now);
  const getNow = (type: string) => nowParts.find((p) => p.type === type)?.value ?? '';

  const hh = get('hour') === '24' ? '00' : get('hour');
  const time = `${hh}:${get('minute')}`;
  const sameDay =
    get('year') === getNow('year') &&
    get('month') === getNow('month') &&
    get('day') === getNow('day');
  if (sameDay) return time;
  return `${get('month')}-${get('day')} ${time}`;
}

function tzOf(payload: NotificationEventPayload): string {
  const tz = (payload.timezone as string | undefined) ?? DEFAULT_TZ;
  return tz || DEFAULT_TZ;
}

function strField(payload: NotificationEventPayload, key: string): string {
  const v = payload[key];
  return typeof v === 'string' ? v : '';
}

function formatPauseSummaryItems(payload: NotificationEventPayload): string {
  const items = payload.items;
  if (!Array.isArray(items) || items.length === 0) return '';
  return items
    .map((it) => {
      if (typeof it !== 'object' || it === null) return '';
      const peer = (it as Record<string, unknown>).peerKey;
      const count = (it as Record<string, unknown>).count;
      return `• ${typeof peer === 'string' ? peer : 'unknown'}${typeof count === 'number' ? ` (${count})` : ''}`;
    })
    .filter(Boolean)
    .join('\n');
}

// ─── Telegram formatters (project Markdown: *bold*, _italic_, `code`) ───

export function formatTelegram(
  event: NotificationEventName,
  payload: NotificationEventPayload,
  now: Date = new Date(),
): string {
  const tz = tzOf(payload);
  const peerKey = strField(payload, 'peerKey');
  const agentId = payload.agentId;

  switch (event) {
    case 'peer_pause_started': {
      const expires = formatEventTime(strField(payload, 'expiresAt'), tz, now);
      return [
        `*Auto-pause* — \`${agentId}\``,
        `Peer \`${peerKey}\` paused${expires ? ` until _${expires}_` : ''}.`,
        payload.reason ? `Reason: \`${String(payload.reason)}\`` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'peer_pause_ended': {
      const ended = formatEventTime(strField(payload, 'endedAt'), tz, now);
      const reason = strField(payload, 'reason') || 'ttl_expired';
      return [
        `*Pause ended* — \`${agentId}\``,
        `Peer \`${peerKey}\` resumed${ended ? ` at _${ended}_` : ''}.`,
        `Reason: \`${reason}\``,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'peer_pause_intervened_during_generation': {
      const at = formatEventTime(strField(payload, 'at'), tz, now);
      return [
        `*Intervention suppressed* — \`${agentId}\``,
        `Mid-generation send to \`${peerKey}\` was blocked${at ? ` at _${at}_` : ''}.`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'peer_pause_summary_daily': {
      const total =
        typeof payload.activePauses === 'number'
          ? payload.activePauses
          : Array.isArray(payload.items)
            ? payload.items.length
            : 0;
      const itemsBlock = formatPauseSummaryItems(payload);
      return [
        `*Daily pause summary* — \`${agentId}\``,
        `_Active pauses: ${total}_`,
        itemsBlock,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'agent_error': {
      const at = formatEventTime(strField(payload, 'at'), tz, now);
      const message = strField(payload, 'message') || 'Unknown error';
      return [
        `*Agent error* — \`${agentId}\``,
        at ? `_${at}_` : '',
        `\`${message}\``,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'iteration_budget_exhausted': {
      const turns = payload.turns;
      return [
        `*Iteration budget exhausted* — \`${agentId}\``,
        peerKey ? `Peer: \`${peerKey}\`` : '',
        typeof turns === 'number' ? `Turns: \`${turns}\`` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'escalation_needed': {
      const note = strField(payload, 'note');
      return [
        `*Escalation requested* — \`${agentId}\``,
        peerKey ? `Peer: \`${peerKey}\`` : '',
        note ? `_${note}_` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    default: {
      // Exhaustiveness fallback — should never run with the current enum.
      const _exhaustive: never = event;
      void _exhaustive;
      return `Notification: ${String(event)} — ${JSON.stringify(payload)}`;
    }
  }
}

// ─── Plain-text formatters (WhatsApp fallback) ───────────────────────

export function formatPlain(
  event: NotificationEventName,
  payload: NotificationEventPayload,
  now: Date = new Date(),
): string {
  const tz = tzOf(payload);
  const peerKey = strField(payload, 'peerKey');
  const agentId = payload.agentId;

  switch (event) {
    case 'peer_pause_started': {
      const expires = formatEventTime(strField(payload, 'expiresAt'), tz, now);
      return [
        `Auto-pause — ${agentId}`,
        `Peer ${peerKey} paused${expires ? ` until ${expires}` : ''}.`,
        payload.reason ? `Reason: ${String(payload.reason)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'peer_pause_ended': {
      const ended = formatEventTime(strField(payload, 'endedAt'), tz, now);
      const reason = strField(payload, 'reason') || 'ttl_expired';
      return [
        `Pause ended — ${agentId}`,
        `Peer ${peerKey} resumed${ended ? ` at ${ended}` : ''}.`,
        `Reason: ${reason}`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'peer_pause_intervened_during_generation': {
      const at = formatEventTime(strField(payload, 'at'), tz, now);
      return [
        `Intervention suppressed — ${agentId}`,
        `Mid-generation send to ${peerKey} was blocked${at ? ` at ${at}` : ''}.`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'peer_pause_summary_daily': {
      const total =
        typeof payload.activePauses === 'number'
          ? payload.activePauses
          : Array.isArray(payload.items)
            ? payload.items.length
            : 0;
      const itemsBlock = formatPauseSummaryItems(payload);
      return [
        `Daily pause summary — ${agentId}`,
        `Active pauses: ${total}`,
        itemsBlock,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'agent_error': {
      const at = formatEventTime(strField(payload, 'at'), tz, now);
      const message = strField(payload, 'message') || 'Unknown error';
      return [
        `Agent error — ${agentId}`,
        at ? `${at}` : '',
        message,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'iteration_budget_exhausted': {
      const turns = payload.turns;
      return [
        `Iteration budget exhausted — ${agentId}`,
        peerKey ? `Peer: ${peerKey}` : '',
        typeof turns === 'number' ? `Turns: ${turns}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'escalation_needed': {
      const note = strField(payload, 'note');
      return [
        `Escalation requested — ${agentId}`,
        peerKey ? `Peer: ${peerKey}` : '',
        note,
      ]
        .filter(Boolean)
        .join('\n');
    }
    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return `Notification: ${String(event)} — ${JSON.stringify(payload)}`;
    }
  }
}

/**
 * Pick the right formatter for a route's channel.
 * `telegram` → Markdown; everything else → plain text.
 */
export function formatForChannel(
  channel: 'telegram' | 'whatsapp',
  event: NotificationEventName,
  payload: NotificationEventPayload,
  now: Date = new Date(),
): string {
  return channel === 'telegram' ? formatTelegram(event, payload, now) : formatPlain(event, payload, now);
}

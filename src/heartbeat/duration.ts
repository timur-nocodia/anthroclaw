const DURATION_RE = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/i;

export function parseHeartbeatDurationMs(value: string, opts: { defaultUnit?: 'm' | 'h' | 'd' } = {}): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = /^(\d+)$/.exec(trimmed);
  const normalized = numeric && opts.defaultUnit
    ? `${numeric[1]}${opts.defaultUnit}`
    : trimmed;

  const match = DURATION_RE.exec(normalized);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2].toLowerCase()[0];
  const minute = 60_000;
  if (unit === 'm') return amount * minute;
  if (unit === 'h') return amount * 60 * minute;
  if (unit === 'd') return amount * 24 * 60 * minute;
  if (unit === 'w') return amount * 7 * 24 * 60 * minute;
  return null;
}


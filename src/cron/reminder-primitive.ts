export interface RuntimeReminderIntent {
  fireAt: Date;
  schedule: string;
  message: string;
}

interface ParseReminderOptions {
  nowMs?: number;
  timezone?: string;
}

const REMINDER_TRIGGER_RE = /(напомни|напомнить|напоминан(?:ие|ия|ию|ием)?|remind(?:er)?)/i;
const RELATIVE_TIME_RE = /(?:через|спустя)\s+(\d{1,4})\s*(минут(?:у|ы)?|мин\.?|м\b|час(?:а|ов)?|ч\b|д(?:ень|ня|ней)?|дн(?:я|ей)?)/i;
const ABSOLUTE_TIME_RE = /(?:^|\s)(?:в|на)\s+(\d{1,2})[:.](\d{2})(?:\s|$|[,.!?;:])/i;

export function parseRuntimeReminderIntent(
  text: string,
  opts: ParseReminderOptions = {},
): RuntimeReminderIntent | null {
  const source = text.trim();
  if (!source || !REMINDER_TRIGGER_RE.test(source)) return null;

  const nowMs = opts.nowMs ?? Date.now();
  const timezone = opts.timezone ?? 'UTC';
  const relative = RELATIVE_TIME_RE.exec(source);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const deltaMs = amount * unitToMs(unit);
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return null;
    const message = extractReminderMessage(source, relative.index + relative[0].length);
    if (!message) return null;
    const fireAt = new Date(nowMs + deltaMs);
    return { fireAt, schedule: cronScheduleFromUtcDate(fireAt), message };
  }

  const absolute = ABSOLUTE_TIME_RE.exec(source);
  if (absolute) {
    const hour = Number(absolute[1]);
    const minute = Number(absolute[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    const now = new Date(nowMs);
    const nowParts = getZonedParts(now, timezone);
    const addDays = /\bзавтра\b/i.test(source) ? 1 : 0;
    let fireAt = zonedTimeToUtc({
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day + addDays,
      hour,
      minute,
    }, timezone);
    if (addDays === 0 && fireAt.getTime() <= nowMs + 30_000) {
      fireAt = zonedTimeToUtc({
        year: nowParts.year,
        month: nowParts.month,
        day: nowParts.day + 1,
        hour,
        minute,
      }, timezone);
    }
    const message = extractReminderMessage(source, absolute.index + absolute[0].length);
    if (!message) return null;
    return { fireAt, schedule: cronScheduleFromUtcDate(fireAt), message };
  }

  return null;
}

export function formatRuntimeReminderPrompt(message: string): string {
  return `Return exactly this reminder text and nothing else: "${formatReminderText(message)}"`;
}

export function formatReminderText(message: string): string {
  return `⏰ Напоминание: ${message}`;
}

export function formatRuntimeReminderAck(
  intent: RuntimeReminderIntent,
  timezone = 'UTC',
  nowMs = Date.now(),
): string {
  const fire = getZonedParts(intent.fireAt, timezone);
  const now = getZonedParts(new Date(nowMs), timezone);
  const sameDay = fire.year === now.year && fire.month === now.month && fire.day === now.day;
  const time = `${pad2(fire.hour)}:${pad2(fire.minute)}`;
  const when = sameDay ? `в ${time}` : `${pad2(fire.day)}.${pad2(fire.month)} в ${time}`;
  return `Готово. Напомню ${when}: ${intent.message}`;
}

export function buildRuntimeReminderId(fireAt: Date, nonce: string): string {
  const stamp = fireAt.toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  const safeNonce = nonce.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'runtime';
  return `runtime-reminder-${stamp}-${safeNonce}`;
}

function unitToMs(unit: string): number {
  if (unit.startsWith('м')) return 60_000;
  if (unit.startsWith('ч') || unit.startsWith('час')) return 3_600_000;
  if (unit.startsWith('д')) return 86_400_000;
  return Number.NaN;
}

function extractReminderMessage(text: string, afterTimeIndex: number): string {
  const afterTime = cleanupReminderMessage(text.slice(afterTimeIndex));
  if (afterTime) return afterTime;

  return cleanupReminderMessage(
    text
      .replace(REMINDER_TRIGGER_RE, ' ')
      .replace(RELATIVE_TIME_RE, ' ')
      .replace(ABSOLUTE_TIME_RE, ' '),
  );
}

function cleanupReminderMessage(value: string): string {
  return value
    .trim()
    .replace(/^[\s:;,.!?—-]+/, '')
    .replace(/^(?:о\s+том\s*,?\s*что|что|про|о)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。]+$/, '')
    .trim();
}

function cronScheduleFromUtcDate(date: Date): string {
  return [
    date.getUTCMinutes(),
    date.getUTCHours(),
    date.getUTCDate(),
    date.getUTCMonth() + 1,
    '*',
  ].join(' ');
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

function zonedTimeToUtc(parts: ZonedParts, timezone: string): Date {
  const desiredLocalMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let utcMs = desiredLocalMs;
  for (let i = 0; i < 2; i += 1) {
    const actualParts = getZonedParts(new Date(utcMs), timezone);
    const actualLocalMs = Date.UTC(
      actualParts.year,
      actualParts.month - 1,
      actualParts.day,
      actualParts.hour,
      actualParts.minute,
    );
    utcMs += desiredLocalMs - actualLocalMs;
  }
  return new Date(utcMs);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

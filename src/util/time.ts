const RU_WEEKDAY_CAPS: Record<string, string> = {
  понедельник: 'Понедельник',
  вторник: 'Вторник',
  среда: 'Среда',
  четверг: 'Четверг',
  пятница: 'Пятница',
  суббота: 'Суббота',
  воскресенье: 'Воскресенье',
};

export type TimePrefixFormat = 'human-ru' | 'human-en' | 'iso' | 'off';

export function nowInTimezone(tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date());
  const pick = (type: Intl.DateTimeFormatPartTypes): number => {
    const v = parts.find((p) => p.type === type)?.value ?? '0';
    return Number(v);
  };
  const hour = pick('hour') % 24;
  return new Date(pick('year'), pick('month') - 1, pick('day'), hour, pick('minute'), pick('second'));
}

export function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${formatTime(d)}`;
}

export function dailyMemoryPath(d: Date): string {
  const yyyy = d.getFullYear().toString();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `memory/${yyyy}/${mm}/${formatDate(d)}.md`;
}

export function formatHumanDateTimeRu(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const weekdayRaw = get('weekday').toLowerCase();
  const weekday = RU_WEEKDAY_CAPS[weekdayRaw] ?? (weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1));
  return `${weekday}, ${get('hour')}:${get('minute')}, ${get('day')} ${get('month')} ${get('year')}г.`;
}

export function formatHumanDateTimeEn(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')}, ${get('hour')}:${get('minute')}, ${get('day')} ${get('month')} ${get('year')}`;
}

export function formatIsoInTimezone(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function formatTimePrefix(format: TimePrefixFormat, now: Date, tz: string): string {
  switch (format) {
    case 'off':
      return '';
    case 'iso':
      return `[${formatIsoInTimezone(now, tz)} ${tz}] `;
    case 'human-en':
      return `[Now ${formatHumanDateTimeEn(now, tz)} (${tz})] `;
    case 'human-ru':
    default:
      return `[Сейчас ${formatHumanDateTimeRu(now, tz)} (${tz})] `;
  }
}

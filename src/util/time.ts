export function nowInTimezone(tz: string): Date {
  const str = new Date().toLocaleString('en-US', { timeZone: tz });
  return new Date(str);
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

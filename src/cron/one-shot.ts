export function looksLikeOneShotSchedule(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return isConcreteCronField(minute) &&
    isConcreteCronField(hour) &&
    isConcreteCronField(dayOfMonth) &&
    isConcreteCronField(month) &&
    dayOfWeek === '*';
}

export function oneShotScheduleTimeUtc(schedule: string, year = new Date().getUTCFullYear()): number | undefined {
  if (!looksLikeOneShotSchedule(schedule)) return undefined;
  const [minute, hour, dayOfMonth, month] = schedule.trim().split(/\s+/).map(Number);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth, hour, minute, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== dayOfMonth ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return undefined;
  }
  return date.getTime();
}

function isConcreteCronField(value: string): boolean {
  return /^\d+$/.test(value);
}

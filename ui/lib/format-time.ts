/**
 * Relative time formatter — "3 hours ago", "2 days ago", "just now".
 *
 * Used by config-audit indicators on Handoff cards. Kept tiny and
 * dependency-free; if the project ever needs i18n / day-fns / luxon,
 * replace this with the project-wide helper at that time.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

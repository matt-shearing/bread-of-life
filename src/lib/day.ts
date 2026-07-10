/**
 * A calendar-day key in the user's LOCAL timezone, "YYYY-MM-DD".
 *
 * Everything that reasons about "today" vs "yesterday" — the memory review streak,
 * the once-a-day notification dedup, and prayer due-today — must agree on where a
 * day starts, and that boundary has to be LOCAL midnight, not UTC. Using
 * `toISOString()` (UTC) shifts the boundary by the timezone offset (e.g. 08:00 for
 * UTC+8), which silently breaks streaks for morning users. `getFullYear/Month/Date`
 * read the local calendar date, so this is offset-correct.
 */
export function localDayKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The local-day key for the day before `ts` (defaults to now). */
export function yesterdayKey(ts: number = Date.now()): string {
  return localDayKey(ts - 86_400_000);
}

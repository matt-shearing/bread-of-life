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

/**
 * The local-day key for the day before `ts` (defaults to now). Calendar arithmetic, not
 * "minus 24 hours": on the day after a daylight-saving change a local day is 23 or 25
 * hours long, and subtracting 24 hours can land two days back or on the same day.
 */
export function yesterdayKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  return localDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTime());
}

/**
 * Days since 1970-01-01 counted in LOCAL calendar days: the same number from local
 * midnight to local midnight. For anything that rotates daily (the verse of the day).
 */
export function localDayNumber(ts: number = Date.now()): number {
  const d = new Date(ts);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

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

/** English month names, January first. (src/lib/devotionalSpeech.ts keeps its own copy so
 *  that it stays import-free for scripts/test-devotional-speech.mjs.) */
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** A playback position: "4:05", or "1:02:09" past an hour. */
export function formatClock(seconds: number): string {
  let s = seconds;
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(ss).padStart(2, "0")}`;
}

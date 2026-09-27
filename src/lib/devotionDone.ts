/**
 * The completion key of a devotional reading in `db.devotions`:
 * "<devotional>:<YYYY-MM-DD>:<index>", where the index is the reading's position in its
 * day (0 = Morning, 1 = Evening).
 *
 * Devotionals are arranged by calendar day ("MM-DD") and repeat every year, so the key
 * carries the year: without it, a reading finished on 25 September 2026 would already
 * show as done on 25 September 2027. Keys written before v0.5 had no year
 * ("<devotional>:<MM-DD>:<index>"); `normaliseDevotionId` converts them.
 *
 * Pure (no imports beyond the language), so the Node test scripts can load it directly.
 */

const DAY_MS = 86_400_000;

function localMidnight(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * The year a "MM-DD" devotional day belongs to when it is read or finished at `at`:
 * the latest occurrence of that date no later than the day after `at` (the extra day
 * absorbs time-zone slop around midnight). So a day read today is this year's, a day
 * caught up on later is the most recent one, and 31 December finished just after
 * midnight on 1 January is still last year's. 29 February maps to the latest leap year.
 */
export function devotionYear(mmdd: string, at: number = Date.now()): number {
  const [m, d] = mmdd.split("-").map(Number);
  const limit = localMidnight(at) + DAY_MS;
  const start = new Date(at).getFullYear() + 1;
  for (let y = start; y > start - 9; y--) {
    const date = new Date(y, m - 1, d);
    if (date.getMonth() !== m - 1 || date.getDate() !== d) continue; // no 29 Feb this year
    if (date.getTime() <= limit) return y;
  }
  return new Date(at).getFullYear();
}

/** The completion key for reading `index` of devotional day `mmdd`, read or finished at `at`. */
export function devotionDoneId(devotionalId: string, mmdd: string, index: number, at: number = Date.now()): string {
  return `${devotionalId}:${devotionYear(mmdd, at)}-${mmdd}:${index}`;
}

const CURRENT = /^.+:\d{4}-\d{2}-\d{2}:\d+$/;
const LEGACY = /^(.+):(\d{2}-\d{2}):(\d+)$/;
/** The very first format, before a user could choose a devotional: "<MM-DD>:m" or ":e". */
const OLDEST = /^(\d{2}-\d{2}):([me])$/;
const OLDEST_DEVOTIONAL = "spurgeon-morning-evening";

/**
 * The current-format key for a completion key written by an older version, using the
 * time it was completed (or deleted) to place it in a year. Null when `id` is already
 * current or is not a devotion key at all.
 */
export function normaliseDevotionId(id: string, at: number): string | null {
  if (CURRENT.test(id)) return null;
  const legacy = LEGACY.exec(id);
  if (legacy) return devotionDoneId(legacy[1], legacy[2], Number(legacy[3]), at);
  const oldest = OLDEST.exec(id);
  if (oldest) return devotionDoneId(OLDEST_DEVOTIONAL, oldest[1], oldest[2] === "m" ? 0 : 1, at);
  return null;
}

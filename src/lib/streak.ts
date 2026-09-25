import { localDayKey } from "./day.ts";

/**
 * The reading streak: how many consecutive LOCAL days you have read something in the
 * Bible (any chapter recorded in `progress`). One calculation, used by the dashboard's
 * "Reading streak" card and by the daily-reading reminders, so the number in a
 * notification is always the number on the dashboard.
 *
 * A streak is still alive until today is over: if you read yesterday but not yet
 * today, it counts back from yesterday. (Counting only from today made the dashboard
 * show 0 every morning, and would make a 2 pm "keep your streak" reminder impossible.)
 *
 * Days are local calendar days (`localDayKey`), never UTC: at UTC+8 a UTC key moves
 * the day boundary to 8 am, so a morning reading was credited to the day before.
 */
export interface Streak {
  /** Consecutive days, ending today if you have read today, otherwise yesterday. */
  days: number;
  /** Whether today is one of those days. */
  includesToday: boolean;
}

/** The set of local-day keys with any reading, from progress timestamps. */
export function readingDayKeys(timestamps: Iterable<number>): Set<string> {
  const out = new Set<string>();
  for (const ts of timestamps) out.add(localDayKey(ts));
  return out;
}

/** Walk back one local calendar day (safe across DST: steps by date, not by 24 h). */
function previousDay(d: Date): Date {
  const p = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12);
  return p;
}

export function readingStreak(days: Set<string>, now: number = Date.now()): Streak {
  let d = new Date(now);
  d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const includesToday = days.has(localDayKey(d.getTime()));
  if (!includesToday) d = previousDay(d);
  let n = 0;
  while (days.has(localDayKey(d.getTime()))) {
    n++;
    d = previousDay(d);
  }
  return { days: n, includesToday };
}

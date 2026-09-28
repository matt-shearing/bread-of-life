/**
 * "On this day": answered prayers and journal entries from this calendar day in earlier
 * years, for the dashboard tile (src/components/dashboard/OnThisDay.tsx). Pure, so
 * scripts/test-reading-history.mjs can test it.
 */

export interface DayWindow {
  yearsAgo: number;
  /** Local midnight that day, and the local midnight after (exclusive). */
  start: number;
  end: number;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Today's month and day in each earlier year back to `earliestYear`, newest first. On
 * 28 February in a year without a 29th, a leap year's window also covers the 29th, so
 * those memories still come round.
 */
export function dayWindows(now: number, earliestYear: number): DayWindow[] {
  const t = new Date(now);
  const month = t.getMonth();
  const date = t.getDate();
  const out: DayWindow[] = [];
  const feb28 = month === 1 && date === 28 && !isLeap(t.getFullYear());
  for (let y = t.getFullYear() - 1; y >= earliestYear; y--) {
    // Feb 29 has no day this year: skip it (it is covered from the 28th).
    if (month === 1 && date === 29 && !isLeap(y)) continue;
    const start = new Date(y, month, date).getTime();
    const end = new Date(y, month, date + (feb28 && isLeap(y) ? 2 : 1)).getTime();
    out.push({ yearsAgo: t.getFullYear() - y, start, end });
  }
  return out;
}

export interface Memory {
  kind: "answered" | "journal";
  id: string;
  title: string;
  /** The answer note, or the start of the entry. */
  detail: string;
  at: number;
  yearsAgo: number;
}

/** "A year ago today" / "3 years ago today". */
export function yearsAgoLabel(n: number): string {
  return n === 1 ? "A year ago today" : `${n} years ago today`;
}

/**
 * The memories for today, newest year first; within a year answered prayers come before
 * journal entries. Empty when nothing matches.
 */
export function memoriesOnThisDay(
  now: number,
  prayers: { id: string; title: string; status: string; answeredAt: number | null; answerNote: string | null }[],
  journal: { id: string; title: string; text: string; createdAt: number }[],
): Memory[] {
  const times = [
    ...prayers.flatMap((p) => (p.status === "answered" && p.answeredAt ? [p.answeredAt] : [])),
    ...journal.map((j) => j.createdAt),
  ];
  if (!times.length) return [];
  const windows = dayWindows(now, new Date(Math.min(...times)).getFullYear());
  const yearsAgo = (at: number) => windows.find((w) => at >= w.start && at < w.end)?.yearsAgo ?? null;
  const out: Memory[] = [];
  for (const p of prayers) {
    if (p.status !== "answered" || !p.answeredAt) continue;
    const y = yearsAgo(p.answeredAt);
    if (y) out.push({ kind: "answered", id: p.id, title: p.title, detail: p.answerNote ?? "", at: p.answeredAt, yearsAgo: y });
  }
  for (const j of journal) {
    const y = yearsAgo(j.createdAt);
    if (y) out.push({ kind: "journal", id: j.id, title: j.title, detail: j.text, at: j.createdAt, yearsAgo: y });
  }
  return out.sort((a, b) => a.yearsAgo - b.yearsAgo || (a.kind === b.kind ? b.at - a.at : a.kind === "answered" ? -1 : 1));
}

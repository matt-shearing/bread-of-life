import { localDayKey } from "./day.ts";

/**
 * Pure helpers for the History page (src/pages/HistoryPage.tsx): the year heat-map, the
 * month / year chapter counts and how much of each book has been read. No Dexie here, so
 * scripts/test-reading-history.mjs can test them directly.
 */

export interface LoggedChapter {
  dayKey: string;
  osis: string; // "John.3"
  ho: string;
  chapter: number;
  at: number;
}

/** Chapters read per local day. Days known only from `progress` (no log row) count as one. */
export function chaptersPerDay(log: Iterable<LoggedChapter>, extraDays: Iterable<string> = []): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of log) out.set(r.dayKey, (out.get(r.dayKey) ?? 0) + 1);
  for (const d of extraDays) if (!out.has(d)) out.set(d, 1);
  return out;
}

/** Heat-map shade 0–4 for a day's chapter count: none, 1, 2–3, 4–6, 7 or more. */
export function intensity(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

export interface HeatCell {
  key: string; // "YYYY-MM-DD"
  count: number;
  /** After today: drawn empty and not focusable. */
  future: boolean;
}
export interface HeatWeek {
  cells: HeatCell[]; // 7, Sunday first
  /** The month this week starts, when it is the first week showing that month (a column label). */
  monthLabel: string | null;
}

/**
 * The past year as week columns, Sunday to Saturday, ending with the week holding `now`.
 * Built by calendar date at local noon, so a daylight-saving change never skips or
 * repeats a day.
 */
export function heatmapWeeks(counts: Map<string, number>, now: number = Date.now(), weeks = 53, locale?: string): HeatWeek[] {
  const today = new Date(now);
  const todayKey = localDayKey(now);
  // Sunday of this week, then back `weeks - 1` more weeks.
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - (weeks - 1) * 7, 12);
  const out: HeatWeek[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const cells: HeatCell[] = [];
    let monthLabel: string | null = null;
    for (let d = 0; d < 7; d++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d, 12);
      const key = localDayKey(day.getTime());
      if (d === 0 && day.getMonth() !== lastMonth) {
        // Skip the label on a first column that only catches the tail of a month.
        if (w > 0 || day.getDate() <= 7) monthLabel = day.toLocaleDateString(locale, { month: "short" });
        lastMonth = day.getMonth();
      }
      cells.push({ key, count: counts.get(key) ?? 0, future: key > todayKey });
    }
    out.push({ cells, monthLabel });
  }
  return out;
}

/** Chapters logged in the local month or year of `now` (a chapter read on two days counts twice). */
export function chaptersInPeriod(log: Iterable<LoggedChapter>, period: "month" | "year", now: number = Date.now()): number {
  const prefix = localDayKey(now).slice(0, period === "month" ? 7 : 4);
  let n = 0;
  for (const r of log) if (r.dayKey.startsWith(prefix)) n++;
  return n;
}

export interface BookProgress {
  ho: string;
  name: string;
  testament: "OT" | "NT";
  read: number; // distinct chapters read at least once
  total: number;
}

/** How much of each book has been read at least once, in canonical order. */
export function bookProgress(
  books: { ho: string; name: string; testament: "OT" | "NT"; chapters: number }[],
  chaptersRead: Iterable<{ ho: string; chapter: number }>,
): BookProgress[] {
  const seen = new Map<string, Set<number>>();
  for (const c of chaptersRead) {
    let s = seen.get(c.ho);
    if (!s) seen.set(c.ho, (s = new Set()));
    s.add(c.chapter);
  }
  return books.map((b) => ({
    ho: b.ho,
    name: b.name,
    testament: b.testament,
    total: b.chapters,
    read: [...(seen.get(b.ho) ?? [])].filter((c) => c >= 1 && c <= b.chapters).length,
  }));
}

/** The most recent reading days, newest first, each with its chapters in the order read. */
export function recentDays<T extends LoggedChapter>(log: Iterable<T>, days = 10): { dayKey: string; chapters: T[] }[] {
  const by = new Map<string, T[]>();
  for (const r of log) {
    const list = by.get(r.dayKey);
    if (list) list.push(r);
    else by.set(r.dayKey, [r]);
  }
  return [...by.keys()]
    .sort()
    .reverse()
    .slice(0, days)
    .map((dayKey) => ({ dayKey, chapters: by.get(dayKey)!.sort((a, b) => a.at - b.at) }));
}

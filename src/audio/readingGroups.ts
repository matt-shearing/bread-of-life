import { bookByHo, refLabel, refRange } from "@/lib/osis";

/**
 * A plan day is stored as a flat list of chapter-sized readings — Soul Food Max's
 * day 1 is `[Gen 1, Gen 2, Gen 3, Matt 1, Ps 1, Prov 1]`. A listener thinks of that day as
 * FOUR readings: the Old Testament passage (three chapters), the New Testament one, the
 * Psalm and the Proverb. This module recovers those readings so the Now Playing page
 * can list them and "Next reading" can skip a whole passage, not just a chapter.
 *
 * A run of plan readings is one passage while each continues the one before it: the
 * same stream (Old Testament, New Testament, Psalms, Proverbs — Soul Food reads Psalms
 * and Proverbs as streams of their own) and moving forward — the next verses of the
 * same chapter, the next chapter of the same book, or chapter 1 of a later book (the
 * Old Testament stream steps from Job straight to Ecclesiastes). Anything else starts
 * a new reading.
 */

export interface DayReading {
  ho: string;
  chapter: number;
  vStart?: number;
  vEnd?: number;
}

export interface ReadingGroup {
  /** Position of this reading within the day (0-based). */
  index: number;
  /** "Genesis 1–2", "Psalms 119:1-40", "Ruth 4 – 1 Samuel 1". */
  label: string;
  /** "Old Testament", "New Testament", "Psalms" or "Proverbs". */
  kicker: string;
  /** The plan-reading indices (positions in the day's flat list) it covers, in order. */
  items: number[];
}

function continues(prev: DayReading, next: DayReading): boolean {
  const a = bookByHo(prev.ho);
  const b = bookByHo(next.ho);
  if (!a || !b || kickerFor(prev.ho) !== kickerFor(next.ho)) return false;
  if (prev.ho === next.ho) {
    // Next portion of the same chapter: Psalm 119:1-40 then 119:41-88.
    if (next.chapter === prev.chapter) return prev.vEnd != null && next.vStart === prev.vEnd + 1;
    // The next chapter (from its start).
    return next.chapter === prev.chapter + 1 && (next.vStart == null || next.vStart === 1);
  }
  // Into a later book of the same stream (Ruth 4 → 1 Samuel 1).
  return b.order > a.order && next.chapter === 1 && (next.vStart == null || next.vStart === 1);
}

function kickerFor(ho: string): string {
  if (ho === "PSA") return "Psalms";
  if (ho === "PRO") return "Proverbs";
  return bookByHo(ho)?.testament === "NT" ? "New Testament" : "Old Testament";
}

function labelFor(readings: DayReading[]): string {
  const first = readings[0];
  const last = readings[readings.length - 1];
  if (readings.length === 1) return refRange(first.ho, first.chapter, first.vStart, first.vEnd);
  const name = (ho: string) => bookByHo(ho)?.name ?? ho;
  if (first.ho === last.ho) {
    if (first.chapter === last.chapter) {
      // Several portions of one chapter: "Psalms 119:1-88".
      return refRange(first.ho, first.chapter, first.vStart ?? 1, last.vEnd ?? undefined);
    }
    const from = first.vStart != null ? `${first.chapter}:${first.vStart}` : `${first.chapter}`;
    const to = last.vEnd != null ? `${last.chapter}:${last.vEnd}` : `${last.chapter}`;
    return `${name(first.ho)} ${from}–${to}`;
  }
  return `${refRange(first.ho, first.chapter, first.vStart)} – ${refLabel(last.ho, last.chapter)}`;
}

/** Group a plan day's flat reading list into the passages a listener would name. */
export function groupDayReadings(readings: DayReading[]): ReadingGroup[] {
  const runs: number[][] = [];
  readings.forEach((r, i) => {
    const run = runs[runs.length - 1];
    if (run && continues(readings[run[run.length - 1]], r)) run.push(i);
    else runs.push([i]);
  });
  return runs.map((items, index) => {
    const rs = items.map((i) => readings[i]);
    return { index, label: labelFor(rs), kicker: kickerFor(rs[0].ho), items };
  });
}

/** Map each plan-reading index to the index of the reading group it belongs to. */
export function groupIndexByReading(groups: ReadingGroup[]): number[] {
  const out: number[] = [];
  for (const g of groups) for (const i of g.items) out[i] = g.index;
  return out;
}

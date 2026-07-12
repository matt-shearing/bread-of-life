/**
 * Reading plans. A plan is a list of days; each day is a list of readings.
 * A reading is a whole chapter, or — for the "verse portion" plans — a verse
 * *range* within a chapter (e.g. Psalm 7:1-9), so long chapters can be split
 * across days and no stream ever runs dry. Small plans are explicit; longer
 * ones are generated from the bundled book/chapter index (and, for portions,
 * the baked per-chapter verse counts) so they always match BSB's versification.
 * Progress is tracked in Dexie (see db `plans` table) by readings completed,
 * not the calendar, so you can never "fall behind".
 */
import { BOOKS } from "@/lib/osis";
import { loadIndex } from "@/data/bible";

export interface Reading {
  ho: string;
  chapter: number;
  /** Optional verse range within the chapter. Omitted → the whole chapter. */
  vStart?: number;
  vEnd?: number;
}
export interface Plan {
  id: string;
  name: string;
  description: string;
  days: Reading[][];
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

async function chaptersFor(hoList: string[]): Promise<Reading[]> {
  const idx = await loadIndex();
  const out: Reading[] = [];
  for (const ho of hoList) {
    const count = idx.find((b) => b.id === ho)?.chapters ?? 0;
    for (let c = 1; c <= count; c++) out.push({ ho, chapter: c });
  }
  return out;
}

/** Split a reading list into `days` roughly-even buckets. */
function chunk(arr: Reading[], days: number): Reading[][] {
  const base = Math.floor(arr.length / days);
  const extra = arr.length % days;
  const res: Reading[][] = [];
  let i = 0;
  for (let d = 0; d < days; d++) {
    const n = base + (d < extra ? 1 : 0);
    if (n > 0) res.push(arr.slice(i, i + n));
    i += n;
  }
  return res;
}

/* ------------------------------ verse portions ------------------------------ */

/** verses-per-chapter for every book, baked by scripts/build-versification.mjs. */
type Versification = Record<string, number[]>;
let verseCounts: Versification | null = null;
async function loadVersification(): Promise<Versification> {
  if (verseCounts) return verseCounts;
  const res = await fetch(`${import.meta.env.BASE_URL}bible/bsb/versification.json`);
  verseCounts = res.ok ? ((await res.json()) as Versification) : {};
  return verseCounts;
}

/**
 * Give each chapter (by verse count) a share of `portions` total, minimum one
 * each, summing to exactly `portions`. Every chapter gets 1, then the remaining
 * portions are handed out largest-remainder style in proportion to verse count —
 * so long chapters get split more, short chapters stay whole. Requires
 * `portions >= chapters.length`.
 */
function allocatePortions(weights: number[], portions: number): number[] {
  const n = weights.length;
  if (portions <= n) return weights.map(() => 1);
  const extra = portions - n;
  const total = sum(weights) || 1;
  const quota = weights.map((w) => (w / total) * extra);
  const base = quota.map(Math.floor);
  let used = sum(base);
  const order = quota
    .map((q, i) => ({ i, r: q - Math.floor(q) }))
    .sort((a, b) => b.r - a.r);
  let k = 0;
  while (used < extra) {
    base[order[k % n].i]++;
    used++;
    k++;
  }
  return base.map((b) => b + 1);
}

/** Split `verses` (1..verses) into `parts` contiguous, roughly-even ranges. */
function splitRanges(verses: number, parts: number): Array<[number, number]> {
  const m = Math.max(1, Math.min(parts, verses));
  const baseLen = Math.floor(verses / m);
  const rem = verses % m;
  const out: Array<[number, number]> = [];
  let s = 1;
  for (let j = 0; j < m; j++) {
    const len = baseLen + (j < rem ? 1 : 0);
    out.push([s, s + len - 1]);
    s += len;
  }
  return out;
}

/**
 * Turn a stream of whole chapters into exactly `portions` verse-range readings,
 * covering every verse once, in order, never crossing a chapter boundary. A part
 * that spans a whole chapter is emitted as a plain chapter reading (no range).
 */
async function versePortions(hoList: string[], portions: number): Promise<Reading[]> {
  const vc = await loadVersification();
  const chapters: Array<{ ho: string; chapter: number; verses: number }> = [];
  for (const ho of hoList) {
    const counts = vc[ho] ?? [];
    for (let c = 1; c <= counts.length; c++) {
      chapters.push({ ho, chapter: c, verses: counts[c - 1] });
    }
  }
  const alloc = allocatePortions(chapters.map((c) => c.verses), portions);
  const out: Reading[] = [];
  chapters.forEach((c, i) => {
    for (const [a, b] of splitRanges(c.verses, alloc[i])) {
      out.push(
        a === 1 && b === c.verses
          ? { ho: c.ho, chapter: c.chapter }
          : { ho: c.ho, chapter: c.chapter, vStart: a, vEnd: b },
      );
    }
  });
  return out;
}

/* ---------------------------------- plans ----------------------------------- */

let cache: Plan[] | null = null;

export async function getPlans(): Promise<Plan[]> {
  if (cache) return cache;
  const nt = BOOKS.filter((b) => b.testament === "NT").map((b) => b.ho);
  const all = BOOKS.map((b) => b.ho);
  // OT minus Psalms & Proverbs — those get their own daily streams in Soul Food.
  const otStream = BOOKS.filter(
    (b) => b.testament === "OT" && b.ho !== "PSA" && b.ho !== "PRO",
  ).map((b) => b.ho);
  const [ntCh, allCh, otStreamCh] = await Promise.all([
    chaptersFor(nt),
    chaptersFor(all),
    chaptersFor(otStream),
  ]);

  const YEAR = 365;
  const otChunk = chunk(otStreamCh, YEAR); // ~2 whole OT chapters/day, once through

  // Soul Food Max — four whole-chapter streams every day, all year. OT is read
  // once (Genesis→Malachi); the New Testament, a Psalm and a Proverbs chapter
  // cycle so you're fed from every part of Scripture on all 365 days — nothing
  // ever runs out mid-year.
  const soulfoodMax: Reading[][] = range(0, YEAR - 1).map((i) => [
    ...(otChunk[i] ?? []),
    ntCh[i % ntCh.length],
    { ho: "PSA", chapter: (i % 150) + 1 },
    { ho: "PRO", chapter: (i % 31) + 1 },
  ]);

  // Soul Food Classic — the whole Bible in a year as four parallel daily
  // portions. OT in whole chapters; the New Testament, Psalms and Proverbs in
  // verse portions ("part of a psalm and a proverb") sized so each finishes
  // exactly on day 365. Long chapters (Psalm 119, the Sermon on the Mount…)
  // are split across days; short ones stay whole.
  const [ntPortions, psaPortions, proPortions] = await Promise.all([
    versePortions(nt, YEAR),
    versePortions(["PSA"], YEAR),
    versePortions(["PRO"], YEAR),
  ]);
  const soulfoodClassic: Reading[][] = range(0, YEAR - 1).map((i) => [
    ...(otChunk[i] ?? []),
    ntPortions[i],
    psaPortions[i],
    proPortions[i],
  ]);

  cache = [
    {
      id: "john21",
      name: "The Gospel of John",
      description: "One chapter a day for 21 days.",
      days: range(1, 21).map((c) => [{ ho: "JHN", chapter: c }]),
    },
    {
      id: "proverbs31",
      name: "Proverbs in a Month",
      description: "A chapter of wisdom each day (31 days).",
      days: range(1, 31).map((c) => [{ ho: "PRO", chapter: c }]),
    },
    {
      id: "psalms30",
      name: "30 Days in the Psalms",
      description: "Psalms 1–30, one each day.",
      days: range(1, 30).map((c) => [{ ho: "PSA", chapter: c }]),
    },
    {
      id: "nt90",
      name: "New Testament in 90 Days",
      description: "Read through the New Testament in three months.",
      days: chunk(ntCh, 90),
    },
    {
      id: "soulfood365",
      name: "Soul Food Max — Bible in a Year",
      description:
        "Four streams every single day, all year — Old Testament · New Testament · a Psalm · a Proverbs chapter. Whole chapters; nothing runs out mid-year.",
      days: soulfoodMax,
    },
    {
      id: "soulfoodClassic",
      name: "Soul Food Classic — Whole Bible in a Year",
      description:
        "The whole Bible in a year as four gentle daily portions — Old Testament, New Testament, and part of a Psalm and a Proverb — finishing together on day 365.",
      days: soulfoodClassic,
    },
    {
      id: "year365",
      name: "The Bible in a Year",
      description: "The whole story of Scripture across 365 days.",
      days: chunk(allCh, 365),
    },
  ];
  return cache;
}

export async function getPlan(id: string): Promise<Plan | undefined> {
  return (await getPlans()).find((p) => p.id === id);
}

/** Resolve any plan by id — a built-in or a user-created custom plan. */
export async function getAnyPlan(id: string): Promise<Plan | undefined> {
  const builtin = await getPlan(id);
  if (builtin) return builtin;
  const { db } = await import("@/db");
  const c = await db.customPlans.get(id);
  return c ? { id: c.id, name: c.name, description: c.description, days: c.days } : undefined;
}

/** Build day-buckets for a custom plan spanning a canonical book range. */
export async function buildReadingRange(
  startHo: string,
  endHo: string,
  days: number,
): Promise<Reading[][]> {
  const startOrder = BOOKS.find((b) => b.ho === startHo)?.order ?? 1;
  const endOrder = BOOKS.find((b) => b.ho === endHo)?.order ?? startOrder;
  const [lo, hi] = startOrder <= endOrder ? [startOrder, endOrder] : [endOrder, startOrder];
  const hos = BOOKS.filter((b) => b.order >= lo && b.order <= hi).map((b) => b.ho);
  const chapters = await chaptersFor(hos);
  return chunk(chapters, Math.max(1, days));
}

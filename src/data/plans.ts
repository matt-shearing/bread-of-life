/**
 * Reading plans. A plan is a list of days; each day is a list of chapter
 * readings. Small plans are explicit; longer ones are generated from the
 * bundled book/chapter index so they always match BSB's versification.
 * Progress is tracked in Dexie (see db `plans` table) — by chapters completed,
 * not the calendar, so you can never "fall behind".
 */
import { BOOKS } from "@/lib/osis";
import { loadIndex } from "@/data/bible";

export interface Reading {
  ho: string;
  chapter: number;
}
export interface Plan {
  id: string;
  name: string;
  description: string;
  days: Reading[][];
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

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

let cache: Plan[] | null = null;

export async function getPlans(): Promise<Plan[]> {
  if (cache) return cache;
  const nt = BOOKS.filter((b) => b.testament === "NT").map((b) => b.ho);
  const all = BOOKS.map((b) => b.ho);
  const [ntCh, allCh] = await Promise.all([chaptersFor(nt), chaptersFor(all)]);

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

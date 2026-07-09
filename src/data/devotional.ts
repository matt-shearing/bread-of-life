/**
 * Devotionals (public domain). Generalized to support multiple devotionals with
 * either an AM/PM cadence (Spurgeon's Morning & Evening — two readings a day) or
 * a daily cadence (Faith's Checkbook — one reading a day). Each reading carries a
 * parsed scripture reference for deep-linking. Datasets are static JSON built by
 * scripts/build-devotional.mjs and scripts/build-faiths-checkbook.mjs.
 */

export interface DevotionReading {
  label: string; // "Morning" / "Evening" / "" for single-daily
  ref: string;
  ho: string | null;
  chapter: number | null;
  verse: number | null;
  text: string;
}
export interface DevotionDay {
  readings: DevotionReading[];
}

export interface Devotional {
  id: string;
  name: string;
  author: string;
  cadence: "am_pm" | "daily";
  file: string; // basename under public/data/devotional/
}

export const DEVOTIONALS: Devotional[] = [
  { id: "spurgeon-morning-evening", name: "Morning & Evening", author: "C.H. Spurgeon", cadence: "am_pm", file: "spurgeon" },
  { id: "faiths-checkbook", name: "Faith's Checkbook", author: "C.H. Spurgeon", cadence: "daily", file: "faiths-checkbook" },
];

export const devotionalById = (id: string) =>
  DEVOTIONALS.find((d) => d.id === id) ?? DEVOTIONALS[0];

const cache = new Map<string, Record<string, any>>();

async function loadFile(file: string): Promise<Record<string, any>> {
  const hit = cache.get(file);
  if (hit) return hit;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/devotional/${file}.json`);
    const data = res.ok ? await res.json() : {};
    cache.set(file, data);
    return data;
  } catch {
    cache.set(file, {});
    return {};
  }
}

/** Normalize either the generalized {readings:[…]} shape or the legacy Spurgeon
 *  {m,e} shape into a DevotionDay. */
function normalize(raw: any): DevotionDay | null {
  if (!raw) return null;
  if (Array.isArray(raw.readings)) return { readings: raw.readings };
  if (raw.m || raw.e) {
    const readings: DevotionReading[] = [];
    if (raw.m) readings.push({ label: "Morning", ...raw.m });
    if (raw.e) readings.push({ label: "Evening", ...raw.e });
    return { readings };
  }
  return null;
}

export function mmdd(d = new Date()): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function getDevotionDay(dev: Devotional, key: string): Promise<DevotionDay | null> {
  const all = await loadFile(dev.file);
  return normalize(all[key]);
}

export async function devotionKeys(dev: Devotional): Promise<string[]> {
  const all = await loadFile(dev.file);
  return Object.keys(all).sort();
}

/** Which reading to feature by time of day: for AM/PM devotionals, evening after
 *  17:00; for daily devotionals, always the single reading. */
export function currentReadingIndex(day: DevotionDay, d = new Date()): number {
  if (day.readings.length <= 1) return 0;
  return d.getHours() < 17 ? 0 : 1;
}

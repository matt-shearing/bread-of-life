/**
 * Spurgeon's "Morning and Evening" (public domain) — a static dataset keyed by
 * "MM-DD" with morning (m) and evening (e) readings, each carrying a parsed
 * scripture reference for deep-linking into the reader. Built by
 * scripts/build-devotional.mjs.
 */

export interface DevotionEntry {
  ref: string; // display reference, e.g. "Song of Solomon 1:1"
  ho: string | null;
  chapter: number | null;
  verse: number | null;
  text: string; // paragraphs separated by \n\n
}
export interface DevotionDay {
  m: DevotionEntry;
  e: DevotionEntry;
}
export type Slot = "m" | "e";

let cache: Record<string, DevotionDay> | null = null;

export async function loadDevotional(): Promise<Record<string, DevotionDay>> {
  if (cache) return cache;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/devotional/spurgeon.json`);
    cache = res.ok ? ((await res.json()) as Record<string, DevotionDay>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function mmdd(d = new Date()): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The slot to feature by time of day: morning until 17:00, then evening. */
export function currentSlot(d = new Date()): Slot {
  return d.getHours() < 17 ? "m" : "e";
}

export async function getDevotionDay(key: string): Promise<DevotionDay | null> {
  const all = await loadDevotional();
  return all[key] ?? null;
}

/** Ordered list of MM-DD keys (for prev/next navigation). */
export async function devotionKeys(): Promise<string[]> {
  const all = await loadDevotional();
  return Object.keys(all).sort();
}

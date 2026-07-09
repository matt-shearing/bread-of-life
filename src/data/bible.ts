/**
 * Scripture access over the bundled static BSB JSON (public/bible/bsb/*).
 * Immutable, offline, ~10ms cached reads. This is the "static JSON wins" result
 * from the prior data bake-off, on real public-domain BSB text.
 */
import { BOOKS, toBbcccvvv, toOsis, type BookMeta } from "@/lib/osis";
import { db } from "@/db";

export interface VerseItem {
  t: "v";
  n: number;
  text: string;
}
export interface HeadingItem {
  t: "h";
  text: string;
}
export type ChapterItem = VerseItem | HeadingItem;

export interface Chapter {
  number: number;
  items: ChapterItem[];
  audio?: Record<string, string>;
}

export interface Book {
  id: string;
  name: string;
  order: number;
  testament: "OT" | "NT";
  chapters: Chapter[];
}

export interface BookIndexEntry {
  id: string;
  name: string;
  order: number;
  testament: "OT" | "NT";
  chapters: number;
  verses: number;
}

const BASE = "bible/bsb";
const bookCache = new Map<string, Book>();
let indexCache: BookIndexEntry[] | null = null;

async function getJSON<T>(path: string): Promise<T> {
  // Use a root-relative URL so it works under Vite dev, `vite preview`, and Tauri.
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function loadIndex(): Promise<BookIndexEntry[]> {
  if (indexCache) return indexCache;
  indexCache = await getJSON<BookIndexEntry[]>(`${BASE}/index.json`);
  return indexCache;
}

export async function loadBook(ho: string): Promise<Book> {
  const cached = bookCache.get(ho);
  if (cached) return cached;
  const book = await getJSON<Book>(`${BASE}/${ho}.json`);
  bookCache.set(ho, book);
  return book;
}

export async function getChapter(ho: string, chapter: number): Promise<Chapter | null> {
  const book = await loadBook(ho);
  return book.chapters.find((c) => c.number === chapter) ?? null;
}

/* --------------------------- multiple translations --------------------------- */

export interface Translation {
  id: string; // HelloAO id
  name: string;
  short: string;
  bundled?: boolean; // BSB ships offline; others fetch-on-demand + cache
}

export const TRANSLATIONS: Translation[] = [
  { id: "BSB", name: "Berean Standard Bible", short: "BSB", bundled: true },
  { id: "ENGWEBP", name: "World English Bible", short: "WEB" },
  { id: "eng_kjv", name: "King James Version", short: "KJV" },
  { id: "eng_asv", name: "American Standard Version", short: "ASV" },
  { id: "eng_ylt", name: "Young's Literal Translation", short: "YLT" },
];

export const translationById = (id: string) => TRANSLATIONS.find((t) => t.id === id);

function flattenHelloAO(content: unknown[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") parts.push(item);
    else if (item && typeof item === "object" && "text" in item) parts.push(String((item as any).text));
  }
  return parts.join(" ").replace(/¶\s*/g, "").replace(/\s+/g, " ").trim();
}

/** Chapter for any translation. BSB is served from bundled JSON; others are
 *  fetched from HelloAO once and cached in Dexie (offline after first view). */
export async function getChapterFor(
  translation: string,
  ho: string,
  chapter: number,
): Promise<Chapter | null> {
  if (translation === "BSB") return getChapter(ho, chapter);

  const key = `${translation}:${toOsis(ho, chapter)}`;
  const cached = await db.bibleCache.get(key);
  if (cached) return JSON.parse(cached.json) as Chapter;

  try {
    const res = await fetch(`https://bible.helloao.org/api/${translation}/${ho}/${chapter}.json`);
    if (!res.ok) return null;
    const json = await res.json();
    const ch = json.chapter;
    if (!ch) return null;
    const items: ChapterItem[] = [];
    for (const node of ch.content ?? []) {
      if (node.type === "heading") {
        const text = flattenHelloAO(node.content ?? []);
        if (text) items.push({ t: "h", text });
      } else if (node.type === "verse") {
        items.push({ t: "v", n: node.number, text: flattenHelloAO(node.content ?? []) });
      }
    }
    const result: Chapter = { number: chapter, items };
    await db.bibleCache.put({ key, json: JSON.stringify(result), fetchedAt: Date.now() });
    return result;
  } catch {
    return null;
  }
}

export function verses(chapter: Chapter): VerseItem[] {
  return chapter.items.filter((i): i is VerseItem => i.t === "v");
}

export function bookMeta(ho: string): BookMeta | undefined {
  return BOOKS.find((b) => b.ho === ho);
}

/* ---------------------------------- search ----------------------------------- */

export interface SearchHit {
  ho: string;
  chapter: number;
  verse: number;
  text: string;
  bbcccvvv: number;
}

let allVersesCache: SearchHit[] | null = null;

async function loadAllVerses(): Promise<SearchHit[]> {
  if (allVersesCache) return allVersesCache;
  const out: SearchHit[] = [];
  for (const b of BOOKS) {
    const book = await loadBook(b.ho);
    for (const ch of book.chapters) {
      for (const it of ch.items) {
        if (it.t === "v") {
          out.push({
            ho: b.ho,
            chapter: ch.number,
            verse: it.n,
            text: it.text,
            bbcccvvv: toBbcccvvv(b.ho, ch.number, it.n),
          });
        }
      }
    }
  }
  allVersesCache = out;
  return out;
}

/** Full-text search across the bundled BSB. All query words must appear;
 *  exact-phrase matches rank first, then canonical order. */
export async function searchBible(query: string, limit = 200): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const verses = await loadAllVerses();
  const scored: { hit: SearchHit; score: number }[] = [];
  for (const v of verses) {
    const t = v.text.toLowerCase();
    if (terms.every((term) => t.includes(term))) {
      const score = (t.includes(q) ? 1000 : 0) + terms.length;
      scored.push({ hit: v, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.hit.bbcccvvv - b.hit.bbcccvvv);
  return scored.slice(0, limit).map((s) => s.hit);
}

/** Deterministic verse-of-the-day: rotates through a curated list by day number. */
const VOTD: Array<{ ho: string; ch: number; v: number }> = [
  { ho: "JHN", ch: 3, v: 16 }, { ho: "PSA", ch: 23, v: 1 }, { ho: "PRO", ch: 3, v: 5 },
  { ho: "ROM", ch: 8, v: 28 }, { ho: "PHP", ch: 4, v: 6 }, { ho: "ISA", ch: 40, v: 31 },
  { ho: "JOS", ch: 1, v: 9 }, { ho: "MAT", ch: 6, v: 33 }, { ho: "JER", ch: 29, v: 11 },
  { ho: "PSA", ch: 46, v: 1 }, { ho: "HEB", ch: 11, v: 1 }, { ho: "2CO", ch: 5, v: 17 },
  { ho: "GAL", ch: 5, v: 22 }, { ho: "PSA", ch: 119, v: 105 }, { ho: "MAT", ch: 11, v: 28 },
  { ho: "ROM", ch: 12, v: 2 }, { ho: "PHP", ch: 4, v: 13 }, { ho: "1CO", ch: 13, v: 4 },
  { ho: "PSA", ch: 1, v: 1 }, { ho: "JHN", ch: 1, v: 1 }, { ho: "EPH", ch: 2, v: 8 },
];

export async function verseOfTheDay(): Promise<{
  ho: string;
  chapter: number;
  verse: number;
  text: string;
}> {
  const dayNum = Math.floor(Date.now() / 86_400_000);
  const pick = VOTD[dayNum % VOTD.length];
  const ch = await getChapter(pick.ho, pick.ch);
  const v = ch ? verses(ch).find((x) => x.n === pick.v) : undefined;
  return { ho: pick.ho, chapter: pick.ch, verse: pick.v, text: v?.text ?? "" };
}

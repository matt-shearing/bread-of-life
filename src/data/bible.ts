/**
 * Scripture access over the bundled static BSB JSON (public/bible/bsb/*).
 * Immutable, offline, ~10ms cached reads. This is the "static JSON wins" result
 * from the prior data bake-off, on real public-domain BSB text.
 */
import { BOOKS, type BookMeta } from "@/lib/osis";

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

export function verses(chapter: Chapter): VerseItem[] {
  return chapter.items.filter((i): i is VerseItem => i.t === "v");
}

export function bookMeta(ho: string): BookMeta | undefined {
  return BOOKS.find((b) => b.ho === ho);
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

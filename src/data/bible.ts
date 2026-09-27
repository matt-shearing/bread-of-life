/**
 * Scripture access over the bundled static BSB JSON (public/bible/bsb/*).
 * Immutable, offline, ~10ms cached reads. This is the "static JSON wins" result
 * from the prior data bake-off, on real public-domain BSB text.
 */
import { BOOKS, toBbcccvvv, toOsis, type BookMeta } from "@/lib/osis";
import { db } from "@/db";
import { localDayNumber } from "@/lib/day";
import {
  getLicensedChapter,
  isLicensedId,
  licensedTranslationById,
  licensedTranslations,
  type LicensedFailure,
  type LicensedSourceId,
} from "./licensed";

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
  /** Licensed texts: the copyright statement the provider sent with this chapter. */
  copyright?: string;
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

/**
 * Tidy verse text for display. The BSB source puts a space before closing quote
 * marks ("…with him. ”"), which lets a lone ” wrap onto a line of its own; we
 * close that gap. Applied once per chapter as it is loaded, for every translation.
 */
export function normalizeVerseText(text: string): string {
  return text.replace(/\s+([”’])/g, "$1");
}

function normalizeChapter(ch: Chapter): Chapter {
  for (const it of ch.items) if (it.t === "v") it.text = normalizeVerseText(it.text);
  return ch;
}

/** Verses in a whole book (BSB versification), or undefined when the index can't load. */
export async function bookVerseCount(ho: string): Promise<number | undefined> {
  try {
    return (await loadIndex()).find((b) => b.id === ho)?.verses;
  } catch {
    return undefined;
  }
}

export async function loadBook(ho: string): Promise<Book> {
  const cached = bookCache.get(ho);
  if (cached) return cached;
  const book = await getJSON<Book>(`${BASE}/${ho}.json`);
  book.chapters.forEach(normalizeChapter);
  bookCache.set(ho, book);
  return book;
}

export async function getChapter(ho: string, chapter: number): Promise<Chapter | null> {
  const book = await loadBook(ho);
  return book.chapters.find((c) => c.number === chapter) ?? null;
}

/* --------------------------- multiple translations --------------------------- */

/**
 * Where a translation's text comes from:
 *  - `bundled`: the BSB JSON shipped with the app (offline, always).
 *  - `helloao`: public-domain or openly licensed text from the Free Use Bible API
 *    (bible.helloao.org), fetched per chapter and cached for good.
 *  - `esv` / `nlt` / `apibible`: copyrighted text read with YOUR OWN key from the
 *    publisher's API (see src/data/licensed/). Never bundled, cached only within the provider's
 *    limits, and shown with the notice the licence requires.
 */
export type TranslationSource = "bundled" | "helloao" | LicensedSourceId;

export interface Translation {
  id: string; // HelloAO id, "ESV", or "apibible:<bibleId>"
  name: string;
  short: string;
  source: TranslationSource;
  bundled?: boolean; // BSB ships offline; others fetch-on-demand + cache
  /** The copyright or licence line shown under the text. */
  notice: string;
  /** Where the notice links to (a licence or the publisher's site). */
  noticeUrl?: string;
  /** Added under copied verses when the licence asks for more than "(SHORT)". */
  copyNotice?: string;
  /** Only part of the canon (e.g. a New Testament). */
  scope?: string;
  /** The provider's own id for the text (API.Bible's bible id). */
  remoteId?: string;
  /** A credit the provider asks for beside the notice (API.Bible's link). */
  credit?: { label: string; url: string };
  /** Show the copyright the provider sent with each chapter rather than `notice`. */
  preferChapterCopyright?: boolean;
  /** Most of any one book that may be on screen at once (the ESV: half). */
  maxBookShareOnPage?: number;
}

const PD = "Public Domain";
const ccBySa = (who: string) => `${who}. Licensed CC BY-SA 4.0; text from eBible.org.`;

const NET_NOTICE =
  "Scripture quoted by permission. Quotations designated (NET) are from the NET Bible® copyright ©1996, 2019 by Biblical Studies Press, L.L.C. http://netbible.com All rights reserved.";

/** Translations anyone can read: the bundled BSB and free texts from HelloAO. */
export const FREE_TRANSLATIONS: Translation[] = [
  { id: "BSB", name: "Berean Standard Bible", short: "BSB", source: "bundled", bundled: true, notice: PD },
  { id: "ENGWEBP", name: "World English Bible", short: "WEB", source: "helloao", notice: PD },
  { id: "eng_kjv", name: "King James Version", short: "KJV", source: "helloao", notice: PD },
  { id: "eng_asv", name: "American Standard Version", short: "ASV", source: "helloao", notice: PD },
  { id: "eng_ylt", name: "Young's Literal Translation", short: "YLT", source: "helloao", notice: PD },
  {
    id: "eng_net",
    name: "NET Bible®",
    short: "NET",
    source: "helloao",
    notice: NET_NOTICE,
    noticeUrl: "http://netbible.org",
    copyNotice: NET_NOTICE,
  },
  {
    id: "eng_lsv",
    name: "Literal Standard Version",
    short: "LSV",
    source: "helloao",
    notice: ccBySa("Literal Standard Version © 2020 Covenant Press"),
    noticeUrl: "https://ebible.org/Scriptures/details.php?id=englsv",
  },
  { id: "eng_msb", name: "Majority Standard Bible", short: "MSB", source: "helloao", notice: PD },
  { id: "eng_rv5", name: "Revised Version (1885)", short: "RV", source: "helloao", notice: PD },
  { id: "eng_dby", name: "Darby Translation", short: "DBY", source: "helloao", notice: PD },
  { id: "eng_wbs", name: "Webster Bible", short: "WBS", source: "helloao", notice: PD },
  { id: "eng_bbe", name: "Bible in Basic English", short: "BBE", source: "helloao", notice: PD },
  { id: "eng_gnv", name: "Geneva Bible (1599)", short: "GNV", source: "helloao", notice: PD },
  { id: "eng_dra", name: "Douay-Rheims (1899)", short: "DRA", source: "helloao", notice: PD },
  {
    id: "eng_fbv",
    name: "Free Bible Version",
    short: "FBV",
    source: "helloao",
    notice: ccBySa("Free Bible Version © 2018 Dr. Jonathan Gallagher"),
    noticeUrl: "https://ebible.org/Scriptures/details.php?id=engfbv",
  },
  {
    id: "eng_t4t",
    name: "Translation for Translators",
    short: "T4T",
    source: "helloao",
    notice: ccBySa("Translation for Translators © 2008-2017 Ellis W. Deibler, Jr."),
    noticeUrl: "https://ebible.org/Scriptures/details.php?id=eng-t4t",
  },
];

/** Every translation this device can offer right now: the free ones, then those your keys unlock. */
export function allTranslations(): Translation[] {
  return [...FREE_TRANSLATIONS, ...licensedTranslations()];
}

export const translationById = (id: string | null | undefined): Translation | undefined =>
  id ? (FREE_TRANSLATIONS.find((t) => t.id === id) ?? licensedTranslationById(id)) : undefined;

function flattenHelloAO(content: unknown[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") parts.push(item);
    else if (item && typeof item === "object" && "text" in item) parts.push(String((item as any).text));
  }
  return parts.join(" ").replace(/¶\s*/g, "").replace(/\s+/g, " ").trim();
}

/** Why a chapter could not be shown, for the reader's message. */
export type ChapterFailure = LicensedFailure | "offline";

/**
 * Chapter for any translation, with the reason when there is none. BSB is served
 * from bundled JSON; HelloAO texts are fetched once and cached in Dexie (offline
 * after the first view); licensed texts go through their provider and its capped
 * cache.
 */
export async function loadChapterFor(
  translation: string,
  ho: string,
  chapter: number,
): Promise<{ chapter: Chapter | null; failure?: ChapterFailure; fumsToken?: string }> {
  if (translation === "BSB") return { chapter: await getChapter(ho, chapter) };
  const t = translationById(translation);
  if (t && t.source !== "bundled" && t.source !== "helloao") {
    const bookVerses = await bookVerseCount(ho);
    const r = await getLicensedChapter(t, ho, chapter, { bookVerses });
    return r.chapter
      ? { chapter: normalizeChapter(r.chapter), fumsToken: r.fumsToken }
      : { chapter: null, failure: r.failure };
  }
  if (!t && isLicensedId(translation)) return { chapter: null, failure: "no-key" };

  const key = `${translation}:${toOsis(ho, chapter)}`;
  const cached = await db.bibleCache.get(key);
  if (cached) return { chapter: normalizeChapter(JSON.parse(cached.json) as Chapter) };

  try {
    const res = await fetch(`https://bible.helloao.org/api/${translation}/${ho}/${chapter}.json`);
    if (res.status === 404) return { chapter: null, failure: "not-found" };
    if (!res.ok) return { chapter: null, failure: "offline" };
    const json = await res.json();
    const ch = json.chapter;
    if (!ch) return { chapter: null, failure: "not-found" };
    const items: ChapterItem[] = [];
    for (const node of ch.content ?? []) {
      if (node.type === "heading") {
        const text = flattenHelloAO(node.content ?? []);
        if (text) items.push({ t: "h", text });
      } else if (node.type === "verse") {
        items.push({ t: "v", n: node.number, text: flattenHelloAO(node.content ?? []) });
      }
    }
    const result: Chapter = normalizeChapter({ number: chapter, items });
    await db.bibleCache.put({ key, json: JSON.stringify(result), fetchedAt: Date.now() });
    return { chapter: result };
  } catch {
    return { chapter: null, failure: "offline" };
  }
}

/** Chapter for any translation, or null. See `loadChapterFor` for the reason. */
export async function getChapterFor(translation: string, ho: string, chapter: number): Promise<Chapter | null> {
  return (await loadChapterFor(translation, ho, chapter)).chapter;
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

let allVersesCache: Promise<SearchHit[]> | null = null;

async function loadAllVerses(): Promise<SearchHit[]> {
  // Books load in parallel, and concurrent searches share one load.
  allVersesCache ??= Promise.all(BOOKS.map((b) => loadBook(b.ho).then((book) => ({ b, book }))))
    .then((books) => {
      const out: SearchHit[] = [];
      for (const { b, book } of books) {
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
      return out;
    })
    .catch((e) => {
      allVersesCache = null; // a failed load is retried by the next search
      throw e;
    });
  return allVersesCache;
}

/** Full-text search across the bundled BSB. All query words must appear;
 *  exact-phrase matches rank first, then canonical order. `books` limits it to
 *  those book ids (a testament or a single book). */
export async function searchBible(
  query: string,
  limit = 200,
  opts: { books?: ReadonlySet<string> } = {},
): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const verses = await loadAllVerses();
  const scored: { hit: SearchHit; score: number }[] = [];
  for (const v of verses) {
    if (opts.books && !opts.books.has(v.ho)) continue;
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
  // The LOCAL calendar day, so the verse changes at local midnight (a UTC day number
  // changed it at 08:00 in Perth).
  const dayNum = localDayNumber();
  const pick = VOTD[dayNum % VOTD.length];
  const ch = await getChapter(pick.ho, pick.ch);
  const v = ch ? verses(ch).find((x) => x.n === pick.v) : undefined;
  return { ho: pick.ho, chapter: pick.ch, verse: pick.v, text: v?.text ?? "" };
}

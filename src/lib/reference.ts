/**
 * Typed Bible references → a place in the reader.
 *
 *   parseReference("jn 3:16")        → John 3:16
 *   parseReference("1 Cor 13:4-7")   → 1 Corinthians 13:4-7
 *   parseReference("1jn1:9")         → 1 John 1:9
 *   parseReference("II Kings 2")     → 2 Kings 2
 *   parseReference("Song of Songs 2")→ Song of Solomon 2
 *   parseReference("Jude 5")         → Jude 1:5 (one-chapter books take a verse)
 *   parseReference("love")           → null
 *
 * Used by the Search page ("Go to …"), the Ctrl+K palette and anywhere else a person
 * types a reference. Pure and dependency-free apart from the book list, so the node
 * test (scripts/test-reference.mjs) can import it directly.
 */
import { BOOKS, type BookMeta } from "./osis.ts";

export interface ParsedRef {
  ho: string;
  chapter: number;
  verse?: number;
  /** Last verse of a range (in `chapterEnd` if that is set, else in `chapter`). */
  verseEnd?: number;
  /** Last chapter of a range spanning chapters ("Gen 1-3", "John 3:16-4:2"). */
  chapterEnd?: number;
  /** Only a book was typed ("Romans") — we open its first chapter. */
  bookOnly?: boolean;
}

/** Chapters per book, standard English versification (as the bundled BSB). */
const CHAPTERS: Record<string, number> = {
  GEN: 50, EXO: 40, LEV: 27, NUM: 36, DEU: 34, JOS: 24, JDG: 21, RUT: 4, "1SA": 31, "2SA": 24,
  "1KI": 22, "2KI": 25, "1CH": 29, "2CH": 36, EZR: 10, NEH: 13, EST: 10, JOB: 42, PSA: 150, PRO: 31,
  ECC: 12, SNG: 8, ISA: 66, JER: 52, LAM: 5, EZK: 48, DAN: 12, HOS: 14, JOL: 3, AMO: 9, OBA: 1,
  JON: 4, MIC: 7, NAM: 3, HAB: 3, ZEP: 3, HAG: 2, ZEC: 14, MAL: 4, MAT: 28, MRK: 16, LUK: 24,
  JHN: 21, ACT: 28, ROM: 16, "1CO": 16, "2CO": 13, GAL: 6, EPH: 6, PHP: 4, COL: 4, "1TH": 5,
  "2TH": 3, "1TI": 6, "2TI": 4, TIT: 3, PHM: 1, HEB: 13, JAS: 5, "1PE": 5, "2PE": 3, "1JN": 5,
  "2JN": 1, "3JN": 1, JUD: 1, REV: 22,
};

export function chapterCount(ho: string): number {
  return CHAPTERS[ho] ?? 0;
}

/**
 * Common abbreviations, keyed WITHOUT spaces or dots ("1 Cor." → "1cor"). Full names,
 * OSIS ids and our 3-letter ids are added automatically below; this list covers the
 * rest. Ambiguous stems ("jo", "ph", "co") are left out on purpose.
 */
const ALIASES: Record<string, string[]> = {
  GEN: ["ge", "gn"],
  EXO: ["ex", "exo", "exod"],
  LEV: ["le", "lv"],
  NUM: ["nu", "nm", "nb"],
  DEU: ["dt", "de", "deut"],
  JOS: ["jsh"],
  JDG: ["jg", "jdgs", "judg"],
  RUT: ["ru", "rth"],
  EZR: ["ezr"],
  NEH: ["ne"],
  EST: ["es", "esth"],
  JOB: ["jb"],
  PSA: ["ps", "psa", "psalm", "pss", "psm", "pslm", "psalter"],
  PRO: ["pr", "prv", "pro"],
  ECC: ["ec", "ecc", "eccles", "qoh", "qoheleth"],
  SNG: ["so", "sos", "ss", "songs", "songofsongs", "songofsol", "canticles", "cant", "canticleofcanticles"],
  ISA: ["is"],
  JER: ["je", "jr"],
  LAM: ["la"],
  EZK: ["eze", "ezk"],
  DAN: ["da", "dn"],
  HOS: ["ho"],
  JOL: ["joe", "jl"],
  AMO: ["am"],
  OBA: ["ob", "obd"],
  JON: ["jnh", "jon"],
  MIC: ["mi"],
  NAM: ["na"],
  HAB: ["hb"],
  ZEP: ["zep", "zp"],
  HAG: ["hg"],
  ZEC: ["zec", "zc"],
  MAL: ["ml"],
  MAT: ["mt", "mat"],
  MRK: ["mk", "mr", "mar"],
  LUK: ["lk", "lu", "luk"],
  JHN: ["jn", "joh"],
  ACT: ["ac", "act"],
  ROM: ["ro", "rm"],
  GAL: ["ga"],
  EPH: ["ephes"],
  PHP: ["php", "pp", "phil", "philip"],
  COL: ["col"],
  TIT: ["ti", "tit"],
  PHM: ["phm", "philem", "phile", "phlm"],
  HEB: ["he"],
  JAS: ["jm", "jam", "jms", "jas"],
  JUD: ["jud", "jd"],
  REV: ["re", "rv", "revelations", "apocalypse", "therevelation"],
};
/** Numbered books: stems that follow "1", "2" or "3". */
const NUMBERED_ALIASES: Record<string, string[]> = {
  SA: ["s", "sa", "sm", "sam", "samuel"],
  KI: ["k", "ki", "kg", "kgs", "kings", "kin"],
  CH: ["ch", "chr", "chron", "chronicles"],
  CO: ["co", "cor", "corinthians"],
  TH: ["th", "thes", "thess", "thessalonians"],
  TI: ["ti", "tim", "tm", "timothy"],
  PE: ["p", "pe", "pet", "pt", "peter"],
  JN: ["j", "jn", "jo", "joh", "jhn", "john"],
};

const norm = (s: string) => s.toLowerCase().replace(/[\s.']/g, "");

const BY_ALIAS = new Map<string, BookMeta>();
const FULL_NAMES: { key: string; book: BookMeta }[] = [];
for (const b of BOOKS) {
  const full = norm(b.name);
  FULL_NAMES.push({ key: full, book: b });
  for (const k of [full, norm(b.osis), norm(b.ho), ...(ALIASES[b.ho] ?? [])]) BY_ALIAS.set(k, b);
  const m = /^([123])(.+)$/.exec(b.ho);
  if (m) for (const stem of NUMBERED_ALIASES[m[2]] ?? []) BY_ALIAS.set(m[1] + stem, b);
}
// "Psalms"/"Psalm" and "Song of Solomon"/"Song" are covered by the name + aliases.

const ORDINALS: Record<string, string> = { i: "1", ii: "2", iii: "3", first: "1", second: "2", third: "3", "1st": "1", "2nd": "2", "3rd": "3" };

/** Find a book from what was typed ("jn", "1 cor", "Song of Songs", "III John"). */
export function findBook(typed: string): BookMeta | null {
  let t = typed.trim().toLowerCase();
  // Roman numerals and ordinals in front of a book name → digits.
  const lead = /^(iii|ii|i|first|second|third|1st|2nd|3rd)\s+(?=[a-z])/.exec(t);
  if (lead) t = ORDINALS[lead[1]] + t.slice(lead[0].length);
  const key = norm(t);
  if (!key) return null;
  const exact = BY_ALIAS.get(key);
  if (exact) return exact;
  // A unique prefix of a full name ("genes", "philip", "habak").
  if (key.replace(/^\d/, "").length >= 3) {
    const hits = FULL_NAMES.filter((f) => f.key.startsWith(key));
    if (hits.length === 1) return hits[0].book;
  }
  return null;
}

const SINGLE_CHAPTER = new Set(["OBA", "PHM", "2JN", "3JN", "JUD"]);

/**
 * Parse a typed reference. Returns null for anything that isn't one (plain search
 * words) or that points past the end of a book ("John 30").
 */
export function parseReference(input: string): ParsedRef | null {
  let s = input
    .toLowerCase()
    .replace(/[‐-―−]/g, "-") // hyphens, en/em dashes, minus → "-"
    .replace(/\s+to\s+/g, "-")
    .replace(/[,;]\s*$/, "")
    .trim();
  if (!s) return null;
  const lead = /^(iii|ii|i|first|second|third|1st|2nd|3rd)\s+(?=[a-z])/.exec(s);
  if (lead) s = ORDINALS[lead[1]] + " " + s.slice(lead[0].length);

  // [1-3]? book-name  rest-of-numbers
  const m = /^([123])?\s*([a-z][a-z .']*?)\.?\s*(\d.*)?$/.exec(s);
  if (!m) return null;
  const book = findBook((m[1] ?? "") + m[2]);
  if (!book) return null;
  const max = chapterCount(book.ho);
  const rest = (m[3] ?? "").replace(/\s*(?:verses?|vv?)\.?\s*/g, ":").replace(/(\d)[ab]\b/g, "$1").trim();

  if (!rest) return { ho: book.ho, chapter: 1, bookOnly: true };

  const num = (x: string | undefined) => (x == null ? undefined : Number(x));
  let r: ParsedRef | null = null;
  let mm: RegExpExecArray | null;
  if ((mm = /^(\d+)$/.exec(rest))) {
    const n = Number(mm[1]);
    r = SINGLE_CHAPTER.has(book.ho) && n > 1 ? { ho: book.ho, chapter: 1, verse: n } : { ho: book.ho, chapter: n };
  } else if ((mm = /^(\d+)\s*-\s*(\d+)$/.exec(rest))) {
    // "Gen 1-3" is chapters; "Jude 3-5" (one chapter) is verses.
    const a = Number(mm[1]);
    const b = Number(mm[2]);
    r = SINGLE_CHAPTER.has(book.ho)
      ? { ho: book.ho, chapter: 1, verse: a, verseEnd: b }
      : { ho: book.ho, chapter: a, chapterEnd: b };
  } else if ((mm = /^(\d+)\s*[:.\s]\s*(\d+)(?:\s*-\s*(\d+)(?:\s*[:.]\s*(\d+))?)?$/.exec(rest))) {
    const [, c, v, x, y] = mm;
    r = { ho: book.ho, chapter: Number(c), verse: Number(v) };
    if (y != null) {
      r.chapterEnd = num(x);
      r.verseEnd = num(y);
    } else if (x != null) r.verseEnd = num(x);
  }
  if (!r) return null;
  if (r.chapter < 1 || r.chapter > max) return null;
  if (r.verse != null && r.verse < 1) return null;
  if (r.chapterEnd != null && (r.chapterEnd < r.chapter || r.chapterEnd > max)) return null;
  if (r.verseEnd != null && r.chapterEnd == null && r.verse != null && r.verseEnd < r.verse) return null;
  return r;
}

/** "John 3:16", "1 Corinthians 13:4-7", "Genesis 1-3", "John 3:16-4:2". */
export function formatReference(r: ParsedRef): string {
  const name = BOOKS.find((b) => b.ho === r.ho)?.name ?? r.ho;
  const book = r.ho === "PSA" && r.chapterEnd == null ? "Psalm" : name;
  if (r.bookOnly) return name;
  let out = `${book} ${r.chapter}`;
  if (r.verse != null) out += `:${r.verse}`;
  if (r.chapterEnd != null) out += r.verseEnd != null ? `-${r.chapterEnd}:${r.verseEnd}` : `-${r.chapterEnd}`;
  else if (r.verseEnd != null && r.verseEnd !== r.verse) out += `-${r.verseEnd}`;
  return out;
}

/**
 * Canonical verse identity.
 *
 * We adopt the scheme proven in `commentary-parser` so this app can interop with
 * Matt's own commentary corpus and any Bible software:
 *   - OSIS string:  "John.3.16"  (book.chapter.verse) / "John.3" for a chapter
 *   - BBCCCVVV int:  book*1_000_000 + chapter*1_000 + verse
 *
 * BOOKS lists all 66 in canonical order. `ho` = the HelloAO/USFM 3-letter id used
 * by our bundled data files; `osis` = the OSIS abbreviation. Chapter counts are
 * read at runtime from public/bible/bsb/index.json (authoritative for BSB's
 * versification), so they are intentionally absent here.
 */
export interface BookMeta {
  ho: string; // HelloAO / USFM id, matches public/bible/bsb/<ho>.json
  osis: string;
  name: string;
  order: number; // 1..66
  testament: "OT" | "NT";
}

const RAW: Array<[ho: string, osis: string, name: string]> = [
  ["GEN", "Gen", "Genesis"], ["EXO", "Exod", "Exodus"], ["LEV", "Lev", "Leviticus"],
  ["NUM", "Num", "Numbers"], ["DEU", "Deut", "Deuteronomy"], ["JOS", "Josh", "Joshua"],
  ["JDG", "Judg", "Judges"], ["RUT", "Ruth", "Ruth"], ["1SA", "1Sam", "1 Samuel"],
  ["2SA", "2Sam", "2 Samuel"], ["1KI", "1Kgs", "1 Kings"], ["2KI", "2Kgs", "2 Kings"],
  ["1CH", "1Chr", "1 Chronicles"], ["2CH", "2Chr", "2 Chronicles"], ["EZR", "Ezra", "Ezra"],
  ["NEH", "Neh", "Nehemiah"], ["EST", "Esth", "Esther"], ["JOB", "Job", "Job"],
  ["PSA", "Ps", "Psalms"], ["PRO", "Prov", "Proverbs"], ["ECC", "Eccl", "Ecclesiastes"],
  ["SNG", "Song", "Song of Solomon"], ["ISA", "Isa", "Isaiah"], ["JER", "Jer", "Jeremiah"],
  ["LAM", "Lam", "Lamentations"], ["EZK", "Ezek", "Ezekiel"], ["DAN", "Dan", "Daniel"],
  ["HOS", "Hos", "Hosea"], ["JOL", "Joel", "Joel"], ["AMO", "Amos", "Amos"],
  ["OBA", "Obad", "Obadiah"], ["JON", "Jonah", "Jonah"], ["MIC", "Mic", "Micah"],
  ["NAM", "Nah", "Nahum"], ["HAB", "Hab", "Habakkuk"], ["ZEP", "Zeph", "Zephaniah"],
  ["HAG", "Hag", "Haggai"], ["ZEC", "Zech", "Zechariah"], ["MAL", "Mal", "Malachi"],
  ["MAT", "Matt", "Matthew"], ["MRK", "Mark", "Mark"], ["LUK", "Luke", "Luke"],
  ["JHN", "John", "John"], ["ACT", "Acts", "Acts"], ["ROM", "Rom", "Romans"],
  ["1CO", "1Cor", "1 Corinthians"], ["2CO", "2Cor", "2 Corinthians"], ["GAL", "Gal", "Galatians"],
  ["EPH", "Eph", "Ephesians"], ["PHP", "Phil", "Philippians"], ["COL", "Col", "Colossians"],
  ["1TH", "1Thess", "1 Thessalonians"], ["2TH", "2Thess", "2 Thessalonians"],
  ["1TI", "1Tim", "1 Timothy"], ["2TI", "2Tim", "2 Timothy"], ["TIT", "Titus", "Titus"],
  ["PHM", "Phlm", "Philemon"], ["HEB", "Heb", "Hebrews"], ["JAS", "Jas", "James"],
  ["1PE", "1Pet", "1 Peter"], ["2PE", "2Pet", "2 Peter"], ["1JN", "1John", "1 John"],
  ["2JN", "2John", "2 John"], ["3JN", "3John", "3 John"], ["JUD", "Jude", "Jude"],
  ["REV", "Rev", "Revelation"],
];

export const BOOKS: BookMeta[] = RAW.map(([ho, osis, name], i) => ({
  ho,
  osis,
  name,
  order: i + 1,
  testament: i < 39 ? "OT" : "NT",
}));

const BY_HO = new Map(BOOKS.map((b) => [b.ho, b]));
const BY_OSIS = new Map(BOOKS.map((b) => [b.osis.toLowerCase(), b]));

export const bookByHo = (ho: string) => BY_HO.get(ho);
export const bookByOsis = (osis: string) => BY_OSIS.get(osis.toLowerCase());

/** "John.3.16" (verse omitted → chapter ref "John.3"). */
export function toOsis(ho: string, chapter: number, verse?: number): string {
  const b = BY_HO.get(ho);
  const abbr = b ? b.osis : ho;
  return verse == null ? `${abbr}.${chapter}` : `${abbr}.${chapter}.${verse}`;
}

/** book*1e6 + chapter*1e3 + verse. */
export function toBbcccvvv(ho: string, chapter: number, verse: number): number {
  const b = BY_HO.get(ho);
  const order = b ? b.order : 0;
  return order * 1_000_000 + chapter * 1_000 + verse;
}

/** Human label, e.g. "John 3:16" or "John 3". */
export function refLabel(ho: string, chapter: number, verse?: number): string {
  const b = BY_HO.get(ho);
  const name = b ? b.name : ho;
  return verse == null ? `${name} ${chapter}` : `${name} ${chapter}:${verse}`;
}

/** Human label for an optional verse range, e.g. "Psalm 7:1-9", "Psalm 7:5",
 *  or "Psalm 7" when no range is given (a whole chapter). */
export function refRange(ho: string, chapter: number, vStart?: number, vEnd?: number): string {
  if (vStart == null) return refLabel(ho, chapter);
  if (vEnd == null || vEnd === vStart) return refLabel(ho, chapter, vStart);
  return `${refLabel(ho, chapter, vStart)}-${vEnd}`;
}

/** Parse an OSIS chapter/verse string back to parts (best-effort). */
export function parseOsis(osis: string): { ho: string; chapter: number; verse?: number } | null {
  const parts = osis.split(".");
  if (parts.length < 2) return null;
  const b = BY_OSIS.get(parts[0].toLowerCase());
  if (!b) return null;
  const chapter = Number(parts[1]);
  const verse = parts[2] != null ? Number(parts[2]) : undefined;
  if (!Number.isFinite(chapter)) return null;
  return { ho: b.ho, chapter, verse };
}

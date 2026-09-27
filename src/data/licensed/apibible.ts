/**
 * Licensed texts from API.Bible (American Bible Society), read with the user's own
 * key. Which texts a key can read depends on the key (the free Starter plan picks
 * three copyrighted Bibles), so the list is fetched (`listApiBibles`) and the user
 * chooses what goes in the picker.
 *
 * API.Bible's terms (https://api.bible/terms-and-conditions, read 2026-09-28) that
 * shape this:
 *  - "All cached content from API.Bible must be updated at least once every 30
 *    days" → APIBIBLE_POLICY.maxAgeMs.
 *  - Every copyrighted text must carry its publisher's notice → the copyright that
 *    comes back with each chapter (or the publisher's own wording, ./catalog.ts).
 *  - "Users on the Starter Plan are required to include a visible citation and
 *    hyperlink to https://api.bible" → shown under the text.
 *  - FUMS is required: every display is reported (./fums.ts).
 *  - "Text may not be used to create audio content" → the app never reads these
 *    texts aloud.
 * The publishers' own limits are tighter than API.Bible's (Lockman: at most 1,000
 * NASB verses stored and never a complete book; Tyndale: 500 NLT verses), so the
 * cache holds at most 500 verses of each text and half of any book.
 */
import type { Chapter, ChapterItem } from "../bible";
import { DAYS, type CapPolicy } from "./cache";
import { failureForStatus, LicensedError, type ChapterResult, type FetchLike } from "./types";

export const API_BIBLE_BASE = "https://api.scripture.api.bible/v1";

export const APIBIBLE_POLICY: CapPolicy = { maxVerses: 500, maxBookShare: 0.5, maxAgeMs: DAYS(30) };

export interface ApiBibleSummary {
  id: string;
  abbreviation: string;
  name: string;
  description?: string;
}

interface Node {
  name?: string;
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  items?: Node[];
}

/** USFM paragraph styles that are headings rather than scripture. */
const HEADING_STYLE = /^(s\d?|ms\d?|mr|sr|r|sp|d|qa|cl|mt\d?)$/;

function verseOf(attrs: Record<string, unknown> | undefined): number | null {
  const id = attrs?.verseId;
  if (typeof id !== "string") return null;
  const n = Number(id.split(".")[2]);
  return Number.isFinite(n) ? n : null;
}

function textOf(node: Node, out: string[]): void {
  if (node.type === "text" && typeof node.text === "string") out.push(node.text);
  if (node.name === "note" || (node.name === "verse" && node.type === "tag")) return;
  for (const child of node.items ?? []) textOf(child, out);
}

/**
 * Walk API.Bible's JSON content. Text nodes carry `attrs.verseId` ("JHN.3.16");
 * gathering them by verse puts a verse back together across paragraphs and poetry
 * lines. Verse-number tags and notes are skipped; heading paragraphs (s1, ms, d…)
 * become headings. A Psalm title (`d`) is kept as a heading.
 */
export function parseApiBibleContent(content: Node[], chapter: number): Chapter {
  const items: ChapterItem[] = [];
  const index = new Map<number, number>();

  const add = (n: number, text: string) => {
    const at = index.get(n);
    if (at !== undefined) {
      const it = items[at] as { text: string };
      it.text = `${it.text} ${text}`;
    } else {
      index.set(n, items.length);
      items.push({ t: "v", n, text });
    }
  };

  const walk = (node: Node) => {
    if (node.name === "note") return;
    if (node.name === "verse" && node.type === "tag") return; // the number itself
    if (node.type === "text" && typeof node.text === "string") {
      const n = verseOf(node.attrs);
      if (n !== null) add(n, node.text);
      return;
    }
    for (const child of node.items ?? []) walk(child);
  };

  for (const para of content) {
    const style = typeof para.attrs?.style === "string" ? para.attrs.style : "";
    if (para.name === "para" && HEADING_STYLE.test(style) && !(para.items ?? []).some((c) => verseOf(c.attrs) !== null)) {
      const parts: string[] = [];
      textOf(para, parts);
      const text = parts.join("").replace(/\s+/g, " ").trim();
      if (text) items.push({ t: "h", text });
      continue;
    }
    walk(para);
  }
  for (const it of items) if (it.t === "v") it.text = it.text.replace(/\s+/g, " ").trim();
  return { number: chapter, items: items.filter((i) => i.t === "h" || i.text) };
}

interface ChapterResponse {
  data?: { content?: Node[]; copyright?: string; reference?: string };
  meta?: { fumsToken?: string };
}

export function apiBibleChapterUrl(bibleId: string, ho: string, chapter: number): string {
  const params = new URLSearchParams({
    "content-type": "json",
    "include-notes": "false",
    "include-titles": "true",
    "include-chapter-numbers": "false",
    "include-verse-numbers": "true",
    "include-verse-spans": "false",
    "fums-version": "3",
  });
  return `${API_BIBLE_BASE}/bibles/${encodeURIComponent(bibleId)}/chapters/${ho}.${chapter}?${params}`;
}

async function call(fetchFn: FetchLike, key: string, url: string) {
  if (!key) throw new LicensedError("no-key");
  let res;
  try {
    res = await fetchFn(url, { headers: { "api-key": key, accept: "application/json" } });
  } catch (e) {
    throw new LicensedError("offline", String(e));
  }
  if (!res.ok) throw new LicensedError(failureForStatus(res.status), `API.Bible ${res.status}`);
  return res.json();
}

/** One chapter, with the copyright API.Bible sent and the FUMS token to report. */
export async function fetchApiBibleChapter(
  fetchFn: FetchLike,
  key: string,
  bibleId: string,
  ho: string,
  chapter: number,
): Promise<ChapterResult> {
  const body = (await call(fetchFn, key, apiBibleChapterUrl(bibleId, ho, chapter))) as ChapterResponse;
  const parsed = parseApiBibleContent(body.data?.content ?? [], chapter);
  if (!parsed.items.some((i) => i.t === "v")) throw new LicensedError("not-found");
  const copyright = body.data?.copyright?.replace(/\s+/g, " ").trim();
  if (copyright) parsed.copyright = copyright;
  return {
    chapter: parsed,
    fumsToken: body.meta?.fumsToken,
  };
}

/** The English texts this key can read. */
export async function listApiBibles(fetchFn: FetchLike, key: string): Promise<ApiBibleSummary[]> {
  const body = (await call(fetchFn, key, `${API_BIBLE_BASE}/bibles?language=eng`)) as {
    data?: { id: string; abbreviation?: string; abbreviationLocal?: string; name?: string; nameLocal?: string; description?: string }[];
  };
  return (body.data ?? [])
    .map((b) => ({
      id: b.id,
      abbreviation: (b.abbreviationLocal || b.abbreviation || b.id).trim(),
      name: (b.nameLocal || b.name || b.id).trim(),
      description: b.description?.trim() || undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

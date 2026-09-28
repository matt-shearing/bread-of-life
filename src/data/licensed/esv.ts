/**
 * The ESV, read from Crossway's ESV API (api.esv.org) with the user's own key.
 *
 * Crossway's conditions (https://api.esv.org/, read 2026-09-28) that shape this:
 *  - "You may not locally store more than 500 verses or one-half of any book of the
 *    Bible (whichever is less)." → ESV_POLICY, enforced by ./cache.ts.
 *  - "You may not display more than 500 verses or one-half of any book (whichever is
 *    less) on any page." → `maxBookShareOnPage` on the translation; the reader pages
 *    a one- or two-chapter book in halves.
 *  - "You must include the standard ESV copyright notice … and identify the passages
 *    as coming from the ESV. Each page on which you use the text must include a link
 *    to www.esv.org." → ESV_NOTICE under the text, linked to esv.org, and "(ESV)" on
 *    every copied quotation.
 *  - "You may not sell, share, or publish your access key." → each user brings their
 *    own key; the app ships none.
 * Rate limits (5,000 a day, 1,000 an hour, 60 a minute) are far above one person
 * reading; a 429 is reported as "rate-limited".
 */
import type { Chapter, ChapterItem } from "../bible";
import { DAYS, type CapPolicy } from "./cache";
import { htmlToPlain } from "./html";
import { failureForStatus, LicensedError, type ChapterResult, type FetchLike } from "./types";

export const ESV_BASE = "https://api.esv.org/v3/passage/html/";

/** Crossway's copyright notice, verbatim. */
export const ESV_NOTICE =
  "Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.";

/** How much ESV text the app may hold at once. The 30-day refresh follows Crossway's
 *  encouragement to clear the cache periodically. */
export const ESV_POLICY: CapPolicy = { maxVerses: 500, maxBookShare: 0.5, maxAgeMs: DAYS(30) };

export interface EsvBook {
  name: string;
  /** Chapters in the book, so a one-chapter book is asked for by name alone. */
  chapters?: number;
}

/** The passage query for one chapter: "John 3", or "Jude" for a one-chapter book. */
export function esvQuery(book: EsvBook, chapter: number): string {
  return book.chapters === 1 ? book.name : `${book.name} ${chapter}`;
}

export function esvUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    "include-passage-references": "false",
    "include-chapter-numbers": "false",
    "include-first-verse-numbers": "true",
    "include-verse-numbers": "true",
    "include-footnotes": "false",
    "include-footnote-body": "false",
    "include-headings": "true",
    "include-subheadings": "true",
    "include-surrounding-chapters": "false",
    "include-surrounding-chapters-below": "false",
    "include-audio-link": "false",
    "include-short-copyright": "false",
    "include-copyright": "false",
    "include-crossrefs": "false",
    "include-book-titles": "false",
  });
  return `${ESV_BASE}?${params}`;
}

/**
 * Turn the passage HTML into our chapter items. Verse markers are
 * `<b class="verse-num" id="v43003016-1">16&nbsp;</b>` (the first verse of a
 * chapter is `chapter-num`); headings are h2–h4. Everything between two markers
 * is that verse's text, whatever paragraph or poetry-line tags it sits in.
 */
export function parseEsvHtml(html: string, chapter: number): Chapter {
  // Drop anything we never show: footnote and cross-reference markers, audio links.
  const clean = html
    // "LORD" is set in small caps as <span class="divine-name">Lord</span>.
    .replace(/<span class="divine-name">([\s\S]*?)<\/span>/gi, (_m, w: string) => w.toUpperCase())
    .replace(/<sup class="(?:footnote|crossref)[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<small class="audio[^"]*"[^>]*>[\s\S]*?<\/small>/gi, "");
  const token = /<(h[2-4])\b[^>]*>([\s\S]*?)<\/\1>|<b class="(?:chapter|verse)-num"[^>]*id="v(\d{2})(\d{3})(\d{3})[^"]*"[^>]*>[\s\S]*?<\/b>/gi;
  const items: ChapterItem[] = [];
  let current: { n: number; parts: string[] } | null = null;
  let last = 0;
  const flush = () => {
    if (!current) return;
    const text = htmlToPlain(current.parts.join(" "));
    if (text) items.push({ t: "v", n: current.n, text });
    current = null;
  };
  for (let m = token.exec(clean); m; m = token.exec(clean)) {
    if (current) current.parts.push(clean.slice(last, m.index));
    last = token.lastIndex;
    if (m[1]) {
      const text = htmlToPlain(m[2]);
      // A heading inside a verse (rare) closes the verse so far; its text resumes after.
      if (current) {
        const n: number = (current as { n: number }).n;
        flush();
        if (text) items.push({ t: "h", text });
        current = { n, parts: [] };
      } else if (text) items.push({ t: "h", text });
      continue;
    }
    const ch = Number(m[4]);
    const n = Number(m[5]);
    flush();
    if (ch !== chapter) continue; // a stray verse of another chapter is never shown
    current = { n, parts: [] };
  }
  if (current) (current as { parts: string[] }).parts.push(clean.slice(last));
  flush();
  // Merge a verse split by a mid-verse heading back into one entry per number.
  const merged: ChapterItem[] = [];
  const seen = new Map<number, number>();
  for (const it of items) {
    if (it.t === "v" && seen.has(it.n)) {
      const prev = merged[seen.get(it.n)!] as { text: string };
      prev.text = `${prev.text} ${it.text}`;
      continue;
    }
    if (it.t === "v") seen.set(it.n, merged.length);
    merged.push(it);
  }
  return { number: chapter, items: merged };
}

interface EsvResponse {
  passages?: string[];
  canonical?: string;
  detail?: string;
}

/** Fetch one chapter. Throws LicensedError with the reason on failure. */
export async function fetchEsvChapter(
  fetchFn: FetchLike,
  key: string,
  book: EsvBook,
  chapter: number,
): Promise<ChapterResult> {
  if (!key) throw new LicensedError("no-key");
  let res;
  try {
    res = await fetchFn(esvUrl(esvQuery(book, chapter)), { headers: { Authorization: `Token ${key}` } });
  } catch (e) {
    throw new LicensedError("offline", String(e));
  }
  if (!res.ok) throw new LicensedError(failureForStatus(res.status), `ESV API ${res.status}`);
  const body = (await res.json()) as EsvResponse;
  const html = body.passages?.join("\n") ?? "";
  const parsed = parseEsvHtml(html, chapter);
  if (!parsed.items.some((i) => i.t === "v")) throw new LicensedError("not-found");
  return { chapter: parsed };
}


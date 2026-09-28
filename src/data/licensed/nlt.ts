/**
 * The New Living Translation, read from Tyndale's NLT API (api.nlt.to) with the
 * user's own free key.
 *
 * Tyndale's conditions (https://api.nlt.to/, read 2026-09-28): with a key, "No more
 * than 500 verses per request", "No more than 5000 requests per day", "Non-commercial
 * use", and "You affirm that your use is consistent with Tyndale's purpose" (each
 * user affirms this when signing up for their key). Tyndale's permissions
 * (https://tyndale.com/permissions) allow up to 500 verses without written permission
 * as long as they are not a complete book, so the cache holds at most 500 verses and
 * half of any book, and the notice below goes under the text and on copied verses.
 */
import type { Chapter, ChapterItem } from "../bible";
import { DAYS, type CapPolicy } from "./cache";
import { htmlToPlain } from "./html";
import { failureForStatus, LicensedError, type ChapterResult, type FetchLike } from "./types";

export const NLT_BASE = "https://api.nlt.to/api/passages";

/** Tyndale's credit line for projects that use several translations, verbatim. */
export const NLT_NOTICE =
  "Scripture quotations marked (NLT) are taken from the Holy Bible, New Living Translation, copyright ©1996, 2004, 2015 by Tyndale House Foundation. Used by permission of Tyndale House Publishers, Carol Stream, Illinois 60188. All rights reserved.";

export const NLT_POLICY: CapPolicy = { maxVerses: 500, maxBookShare: 0.5, maxAgeMs: DAYS(30) };

/** The API's name for a book where it differs from ours. */
const NLT_NAME: Record<string, string> = { "Song of Solomon": "Song of Songs" };

export function nltUrl(bookName: string, chapter: number, key: string): string {
  const params = new URLSearchParams({ ref: `${NLT_NAME[bookName] ?? bookName} ${chapter}`, version: "NLT", key });
  return `${NLT_BASE}?${params}`;
}

/**
 * Each verse arrives wrapped in `<verse_export vn="16">`; headings are
 * `class="subhead"` (and a psalm's title `psa-title`); the chapter banner, the verse
 * number and the translators' notes (`a-tn`, `tn`) are dropped.
 */
export function parseNltHtml(html: string, chapter: number): Chapter {
  const items: ChapterItem[] = [];
  const re = /<verse_export\b[^>]*\bch="(\d+)"[^>]*\bvn="(\d+)"[^>]*>([\s\S]*?)<\/verse_export>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (Number(m[1]) !== chapter) continue;
    const n = Number(m[2]);
    let body = m[3]
      .replace(/<a class="a-tn"[^>]*>[\s\S]*?<\/a>/gi, "")
      .replace(/<span class="tn"[^>]*>(?:[^<]|<(?!\/?span\b)[^>]*>|<span\b[^>]*>[\s\S]*?<\/span>)*<\/span>/gi, "")
      .replace(/<(h\d)[^>]*class="(?:chapter-number|bk_ch_vs_header)"[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<span class="vn"[^>]*>[\s\S]*?<\/span>/gi, "")
      .replace(/<span class="(?:sc|subhead-sc)"[^>]*>([\s\S]*?)<\/span>/gi, (_x, w: string) => w.toUpperCase());
    const headingRe = /<(h\d|p)\b[^>]*class="(?:subhead|psa-title|psa-book)[^"]*"[^>]*>([\s\S]*?)<\/\1>/i;
    for (let h = headingRe.exec(body); h; h = headingRe.exec(body)) {
      const before = htmlToPlain(body.slice(0, h.index));
      if (before) {
        items.push({ t: "v", n, text: before });
      }
      const text = htmlToPlain(h[2]);
      if (text) items.push({ t: "h", text });
      body = body.slice(h.index + h[0].length);
    }
    const text = htmlToPlain(body);
    if (text) items.push({ t: "v", n, text });
  }
  // A verse split by a heading is put back together under its first half.
  const out: ChapterItem[] = [];
  const at = new Map<number, number>();
  for (const it of items) {
    if (it.t === "v" && at.has(it.n)) {
      const prev = out[at.get(it.n)!] as { text: string };
      prev.text = `${prev.text} ${it.text}`;
      continue;
    }
    if (it.t === "v") at.set(it.n, out.length);
    out.push(it);
  }
  return { number: chapter, items: out };
}

export async function fetchNltChapter(
  fetchFn: FetchLike,
  key: string,
  bookName: string,
  chapter: number,
): Promise<ChapterResult> {
  if (!key) throw new LicensedError("no-key");
  let res;
  try {
    res = await fetchFn(nltUrl(bookName, chapter, key));
  } catch (e) {
    throw new LicensedError("offline", String(e));
  }
  if (!res.ok) throw new LicensedError(failureForStatus(res.status), `NLT API ${res.status}`);
  const parsed = parseNltHtml(await res.text(), chapter);
  if (!parsed.items.some((i) => i.t === "v")) throw new LicensedError("not-found");
  return { chapter: parsed };
}

/**
 * Pluggable commentary sources. v1 ships public-domain commentaries from the
 * HelloAO API, fetched per-chapter and cached in Dexie for offline re-reading.
 * The SAME CommentarySource shape will later accept Matt's own commentary-parser
 * corpus as just another entry — that is the "pluggable commentary" the brief
 * has wanted from day one.
 */
import { db } from "@/db";
import { toOsis } from "@/lib/osis";

export interface CommentarySource {
  id: string;
  name: string;
  short: string;
}

export const COMMENTARY_SOURCES: CommentarySource[] = [
  { id: "matthew-henry", name: "Matthew Henry", short: "MH" },
  { id: "jamieson-fausset-brown", name: "Jamieson-Fausset-Brown", short: "JFB" },
  { id: "adam-clarke", name: "Adam Clarke", short: "Clarke" },
  { id: "john-gill", name: "John Gill", short: "Gill" },
  { id: "keil-delitzsch", name: "Keil & Delitzsch", short: "K&D" },
  { id: "tyndale", name: "Tyndale", short: "Tyn" },
];

/**
 * Missler is kept OUT of COMMENTARY_SOURCES (which is the fixed public-domain set)
 * because it only exists when the user has pointed at their local library. The
 * commentary panel appends this pill at runtime once `misslerAvailable()` is true.
 */
export const MISSLER_SOURCE: CommentarySource = {
  id: "missler",
  name: "Missler (Line by Line)",
  short: "Missler",
};

export interface CommentaryBlock {
  verse: number;
  /** Missler groups verses; when present and different from `verse` the block spans
   *  a range (rendered "Verses 19–28"). Absent for single-verse public-domain blocks. */
  endVerse?: number;
  paragraphs: string[];
  /** OSIS refs (Missler only), e.g. "Heb.1.1-Heb.1.3" — rendered as clickable chips. */
  xrefs?: string[];
}
export interface CommentaryChapter {
  intro?: string;
  blocks: CommentaryBlock[];
}

function flatten(content: unknown[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") parts.push(item);
    else if (item && typeof item === "object" && "text" in item) parts.push(String((item as any).text));
  }
  return parts.join(" ");
}

function toParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function fetchCommentaryChapter(
  source: string,
  ho: string,
  chapter: number,
): Promise<CommentaryChapter | null> {
  // The local Missler library reads from disk, never HelloAO/Dexie.
  if (source === MISSLER_SOURCE.id) {
    const { getMisslerCommentary } = await import("./missler");
    return getMisslerCommentary(ho, chapter);
  }

  const key = `${source}:${toOsis(ho, chapter)}`;
  const cached = await db.commentary.get(key);
  if (cached) return JSON.parse(cached.html) as CommentaryChapter;

  try {
    const res = await fetch(`https://bible.helloao.org/api/c/${source}/${ho}/${chapter}.json`);
    if (!res.ok) return null;
    const json = await res.json();
    const ch = json.chapter;
    if (!ch) return null;
    const blocks: CommentaryBlock[] = (ch.content ?? [])
      .filter((n: any) => n.type === "verse")
      .map((n: any) => ({ verse: n.number, paragraphs: toParagraphs(flatten(n.content ?? [])) }));
    const result: CommentaryChapter = {
      intro: ch.introduction ? toParagraphs(ch.introduction).join(" ") : undefined,
      blocks,
    };
    await db.commentary.put({ key, html: JSON.stringify(result), fetchedAt: Date.now() });
    return result;
  } catch {
    return null; // offline and not cached yet
  }
}

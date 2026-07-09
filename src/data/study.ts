/**
 * Study data: cross-references (OpenBible TSK, CC-BY) and Strong's word-study
 * (BSB word tags + Greek/Hebrew lexicon). Both are static per-book JSON built by
 * scripts/build-crossrefs.mjs and scripts/build-strongs.mjs.
 *
 * Note on Strong's: the open BSB tagging is reliable for the NT (Greek) but its
 * OT (Hebrew) word-alignment is approximate — the UI flags OT accordingly.
 */

const BASE = import.meta.env.BASE_URL;

/* ------------------------------ cross-references ------------------------------ */

export interface XrefEntry {
  r: string; // OSIS target, may be a range e.g. "1John.4.9-1John.4.10"
  v: number; // votes
}

const xrefCache = new Map<string, Record<string, XrefEntry[]>>();

async function loadXrefBook(ho: string): Promise<Record<string, XrefEntry[]>> {
  const hit = xrefCache.get(ho);
  if (hit) return hit;
  try {
    const res = await fetch(`${BASE}data/xref/${ho}.json`);
    const data = res.ok ? ((await res.json()) as Record<string, XrefEntry[]>) : {};
    xrefCache.set(ho, data);
    return data;
  } catch {
    xrefCache.set(ho, {});
    return {};
  }
}

export async function getCrossRefs(ho: string, chapter: number, verse: number): Promise<XrefEntry[]> {
  const book = await loadXrefBook(ho);
  return book[`${chapter}.${verse}`] ?? [];
}

/* ---------------------------------- Strong's ---------------------------------- */

export interface StrongToken {
  w: string;
  s: string;
}
export interface LexEntry {
  lemma: string;
  xlit: string;
  gloss: string;
  def: string;
}

const strongsBookCache = new Map<string, Record<string, StrongToken[]>>();
let lexiconCache: Record<string, LexEntry> | null = null;

async function loadStrongsBook(ho: string): Promise<Record<string, StrongToken[]>> {
  const hit = strongsBookCache.get(ho);
  if (hit) return hit;
  try {
    const res = await fetch(`${BASE}data/strongs/${ho}.json`);
    const data = res.ok ? ((await res.json()) as Record<string, StrongToken[]>) : {};
    strongsBookCache.set(ho, data);
    return data;
  } catch {
    strongsBookCache.set(ho, {});
    return {};
  }
}

export async function getStrongsVerse(ho: string, chapter: number, verse: number): Promise<StrongToken[]> {
  const book = await loadStrongsBook(ho);
  return book[`${chapter}.${verse}`] ?? [];
}

export async function loadLexicon(): Promise<Record<string, LexEntry>> {
  if (lexiconCache) return lexiconCache;
  try {
    const res = await fetch(`${BASE}data/strongs/lexicon.json`);
    lexiconCache = res.ok ? ((await res.json()) as Record<string, LexEntry>) : {};
  } catch {
    lexiconCache = {};
  }
  return lexiconCache;
}

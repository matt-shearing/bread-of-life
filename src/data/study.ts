/**
 * Study data: cross-references (OpenBible TSK, CC-BY) and Strong's word-study
 * (BSB word tags + Greek/Hebrew lexicon). Both are static per-book JSON built by
 * scripts/build-crossrefs.mjs and scripts/build-strongs.mjs.
 *
 * Note on Strong's: the open BSB tagging is reliable for the NT (Greek) but its
 * OT (Hebrew) word-alignment is approximate — the UI flags OT accordingly.
 */

import { lexiconShard } from "./lexiconShard";

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

/** Shards already fetched (or in flight), keyed by URL. A failed fetch caches as
 *  empty, like the per-book files, so one missing shard can't wedge the panel. */
const lexShardCache = new Map<string, Promise<Record<string, LexEntry>>>();

function loadLexShard(url: string): Promise<Record<string, LexEntry>> {
  let hit = lexShardCache.get(url);
  if (!hit) {
    hit = fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<Record<string, LexEntry>>) : {}))
      .catch(() => ({}));
    lexShardCache.set(url, hit);
  }
  return hit;
}

/** The lexicon entries for `ids`, fetching only the shards that hold them. */
async function lexiconEntries(dir: string, ids: Iterable<string>): Promise<Record<string, LexEntry>> {
  const wanted = [...new Set(ids)];
  const shards = new Set(wanted.map(lexiconShard).filter((s): s is string => s != null));
  const loaded = await Promise.all([...shards].map((s) => loadLexShard(`${BASE}data/strongs/${dir}/${s}.json`)));
  const all: Record<string, LexEntry> = Object.assign({}, ...loaded);
  const out: Record<string, LexEntry> = {};
  for (const id of wanted) if (all[id]) out[id] = all[id];
  return out;
}

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

/** Greek (NT) lexicon entries for the given Strong's ids. */
export function loadLexicon(ids: Iterable<string>): Promise<Record<string, LexEntry>> {
  return lexiconEntries("lexicon", ids);
}

/* ---- Accurate OT Hebrew interlinear (Open Scriptures Hebrew Bible, CC-BY) ---- */

const hebBookCache = new Map<string, Record<string, StrongToken[]>>();

async function loadHebBook(ho: string): Promise<Record<string, StrongToken[]>> {
  const hit = hebBookCache.get(ho);
  if (hit) return hit;
  try {
    const res = await fetch(`${BASE}data/strongs-heb/${ho}.json`);
    const data = res.ok ? ((await res.json()) as Record<string, StrongToken[]>) : {};
    hebBookCache.set(ho, data);
    return data;
  } catch {
    hebBookCache.set(ho, {});
    return {};
  }
}

export async function getHebrewVerse(ho: string, chapter: number, verse: number): Promise<StrongToken[]> {
  const book = await loadHebBook(ho);
  return book[`${chapter}.${verse}`] ?? [];
}

/** Hebrew (OT, OSHB) lexicon entries for the given Strong's ids. */
export function loadHebLexicon(ids: Iterable<string>): Promise<Record<string, LexEntry>> {
  return lexiconEntries("lexicon-heb", ids);
}

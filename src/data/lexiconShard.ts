/**
 * Strong's lexicons are split into small files by number range so opening the
 * word-study panel fetches only the entries a verse needs (a few ~15 kB files)
 * rather than a 1.2–1.4 MB lexicon.
 *
 * Shared by the app (src/data/study.ts) and the build scripts that write the
 * shards (scripts/lexicon-shards.mjs), so both always agree on the layout.
 */
export const LEXICON_SHARD_SIZE = 100;

/** "G2316" → "G23" (G2300–G2399); "H430" → "H4". Null for a malformed id. */
export function lexiconShard(id: string): string | null {
  const m = /^([GH])(\d+)/.exec(id);
  return m ? `${m[1]}${Math.floor(Number(m[2]) / LEXICON_SHARD_SIZE)}` : null;
}

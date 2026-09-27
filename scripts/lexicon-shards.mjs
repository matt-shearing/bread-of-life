/**
 * Write a Strong's lexicon ({ "G2316": {lemma, xlit, gloss, def}, … }) as one
 * small JSON file per number range (see src/data/lexiconShard.ts), replacing
 * whatever shards were in `dir` before. Used by build-strongs.mjs and
 * build-oshb.mjs. Needs Node 22.18+ (imports the TypeScript module directly).
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lexiconShard } from "../src/data/lexiconShard.ts";

export function writeLexiconShards(dir, lexicon) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(join(dir, f));
  const shards = new Map();
  for (const [id, entry] of Object.entries(lexicon)) {
    const shard = lexiconShard(id);
    if (!shard) throw new Error(`malformed Strong's id: ${id}`);
    if (!shards.has(shard)) shards.set(shard, {});
    shards.get(shard)[id] = entry;
  }
  for (const [shard, entries] of shards) writeFileSync(join(dir, `${shard}.json`), JSON.stringify(entries));
  return shards.size;
}

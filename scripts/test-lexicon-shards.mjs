/**
 * The word-study panel fetches only the lexicon shard files a verse needs. This
 * checks the shards on disk match the layout the app computes, and that every
 * Strong's id tagged in the bundled books can be found in its shard (so the
 * panel never shows a word it can't define because a shard was mis-split).
 *
 * Run: node --test scripts/test-lexicon-shards.mjs   (Node 22.18+)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { lexiconShard } from "../src/data/lexiconShard.ts";

const root = new URL("../public/data/", import.meta.url);
const readJson = (u) => JSON.parse(readFileSync(u, "utf8"));

function loadShards(dir) {
  const byId = new Map();
  for (const f of readdirSync(new URL(`strongs/${dir}/`, root))) {
    const shard = f.replace(/\.json$/, "");
    for (const [id, entry] of Object.entries(readJson(new URL(`strongs/${dir}/${f}`, root)))) {
      assert.equal(lexiconShard(id), shard, `${id} is in ${dir}/${f}`);
      assert.ok(!byId.has(id), `${id} appears twice`);
      byId.set(id, entry);
    }
  }
  return byId;
}

function usedIds(dir) {
  const ids = new Set();
  for (const f of readdirSync(new URL(`${dir}/`, root))) {
    if (!/^[0-9A-Z]{3}\.json$/.test(f)) continue;
    for (const words of Object.values(readJson(new URL(`${dir}/${f}`, root)))) for (const w of words) ids.add(w.s);
  }
  return ids;
}

test("shard ids", () => {
  assert.equal(lexiconShard("G2316"), "G23");
  assert.equal(lexiconShard("H430"), "H4");
  assert.equal(lexiconShard("G5"), "G0");
  assert.equal(lexiconShard("nonsense"), null);
});

for (const [lexDir, wordsDir, min] of [
  ["lexicon", "strongs", 0.99],
  ["lexicon-heb", "strongs-heb", 0.99],
]) {
  test(`${lexDir}: shards are well-formed and cover the tagged words in ${wordsDir}/`, () => {
    const lex = loadShards(lexDir);
    assert.ok(lex.size > 5000, `${lex.size} entries`);
    for (const e of lex.values()) assert.equal(typeof e.lemma, "string");
    const used = usedIds(wordsDir);
    const found = [...used].filter((id) => lex.has(id)).length;
    // A handful of tags have no source-lexicon entry (the build script reports them);
    // anything more means a shard went missing.
    assert.ok(found / used.size >= min, `${found}/${used.size} tagged ids have an entry`);
  });
}

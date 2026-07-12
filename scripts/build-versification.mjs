/**
 * Bake a per-chapter verse-count table from the bundled BSB JSON so reading
 * plans can split long chapters into verse *portions* (e.g. "Psalm 7:1-9")
 * without loading every book at runtime. Emits public/bible/bsb/versification.json:
 *   { "GEN": [31, 25, 24, ...], "PSA": [6, 12, 8, ...], ... }
 * where the array is verses-per-chapter in canonical order. Uses the highest
 * verse number present per chapter (authoritative for BSB's versification).
 *
 * Run: node scripts/build-versification.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "bible", "bsb");

const files = (await readdir(DIR)).filter(
  (f) => f.endsWith(".json") && f !== "index.json" && f !== "versification.json",
);

const table = {};
for (const f of files) {
  const book = JSON.parse(await readFile(join(DIR, f), "utf8"));
  const counts = [];
  for (const ch of book.chapters) {
    let max = 0;
    for (const it of ch.items) if (it.t === "v" && it.n > max) max = it.n;
    counts[ch.number - 1] = max;
  }
  table[book.id] = counts;
}

await writeFile(join(DIR, "versification.json"), JSON.stringify(table));
const total = Object.values(table).reduce(
  (s, arr) => s + arr.reduce((a, b) => a + b, 0),
  0,
);
console.log(
  `versification.json: ${Object.keys(table).length} books, ${total} verses`,
);

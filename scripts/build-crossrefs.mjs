#!/usr/bin/env node
/**
 * Build a static cross-reference dataset from OpenBible.info TSK cross-references.
 *
 * Source: https://a.openbible.info/data/cross-references.zip (CC-BY)
 * Reads /tmp/cross_references.txt (downloads+unzips if absent).
 *
 * Output: public/data/xref/<HO>.json — { "chapter.verse": [{ r, v }, ...] }
 *         public/data/xref/index.json — { books: [...], totalRefs: n }
 *
 * Each entry: { r: "<To Verse OSIS string, verbatim incl. ranges>", v: <votes> }
 * Sorted by votes desc, capped at 40 per verse.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_TXT = "/tmp/cross_references.txt";
const OUT_DIR = join(ROOT, "public/data/xref");
const OSIS_TS = join(ROOT, "src/lib/osis.ts");
const CAP = 40;

// --- 1. Ensure source data present ---
if (!existsSync(SRC_TXT)) {
  console.log("Source missing; downloading cross-references.zip ...");
  execSync(
    "curl -sL https://a.openbible.info/data/cross-references.zip -o /tmp/cross-references.zip && unzip -o /tmp/cross-references.zip -d /tmp",
    { stdio: "inherit" }
  );
}

// --- 2. Parse OSIS abbrev -> ho map from src/lib/osis.ts ---
const tsSrc = readFileSync(OSIS_TS, "utf8");
const osisToHo = new Map();
// match triples like  ["JHN", "John", "John"]
const tripleRe = /\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g;
let m;
while ((m = tripleRe.exec(tsSrc)) !== null) {
  const [, ho, osis] = m;
  osisToHo.set(osis, ho);
}
if (osisToHo.size < 60) {
  throw new Error(`Parsed only ${osisToHo.size} book mappings from osis.ts — expected 66`);
}

// --- 3. Parse rows ---
const raw = readFileSync(SRC_TXT, "utf8");
const lines = raw.split("\n");

// data: ho -> Map("chapter.verse" -> [{r, v}])
const byBook = new Map();
let totalRefs = 0;

// From-verse OSIS: Book.Chapter.Verse  (book may contain digits, e.g. 1Sam)
// Ignore any range on the From side: take first segment before '-'.
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  if (i === 0 && line.startsWith("From Verse")) continue; // header
  const tab = line.indexOf("\t");
  if (tab === -1) continue;
  const tab2 = line.indexOf("\t", tab + 1);
  if (tab2 === -1) continue;
  const fromRaw = line.slice(0, tab);
  const toVerse = line.slice(tab + 1, tab2);
  const votes = Number(line.slice(tab2 + 1).trim());

  // From side: drop any range, keep first verse
  const fromFirst = fromRaw.split("-")[0];
  const parts = fromFirst.split(".");
  if (parts.length < 3) continue; // need book.chapter.verse
  const bookAbbrev = parts[0];
  const ho = osisToHo.get(bookAbbrev);
  if (!ho) continue; // deuterocanon / unknown -> skip

  const key = `${parts[1]}.${parts[2]}`;
  let bookMap = byBook.get(ho);
  if (!bookMap) {
    bookMap = new Map();
    byBook.set(ho, bookMap);
  }
  let arr = bookMap.get(key);
  if (!arr) {
    arr = [];
    bookMap.set(key, arr);
  }
  arr.push({ r: toVerse, v: Number.isFinite(votes) ? votes : 0 });
  totalRefs++;
}

// --- 4. Sort by votes desc, cap at CAP, write per-book files ---
mkdirSync(OUT_DIR, { recursive: true });

const books = [];
let keptRefs = 0;
for (const [ho, bookMap] of byBook) {
  const obj = {};
  for (const [key, arr] of bookMap) {
    arr.sort((a, b) => b.v - a.v);
    const capped = arr.length > CAP ? arr.slice(0, CAP) : arr;
    obj[key] = capped;
    keptRefs += capped.length;
  }
  writeFileSync(join(OUT_DIR, `${ho}.json`), JSON.stringify(obj));
  books.push(ho);
}

// Keep books in canonical (parse) order of osis.ts
const hoOrder = [...osisToHo.values()];
books.sort((a, b) => hoOrder.indexOf(a) - hoOrder.indexOf(b));

writeFileSync(
  join(OUT_DIR, "index.json"),
  JSON.stringify({ books, totalRefs: keptRefs })
);

console.log(`Parsed rows (mapped): ${totalRefs}`);
console.log(`Kept after cap(${CAP}): ${keptRefs}`);
console.log(`Book files: ${books.length}`);

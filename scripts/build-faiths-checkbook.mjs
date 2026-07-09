#!/usr/bin/env node
/**
 * Build a public-domain Spurgeon "Faith's Checkbook" (1888) devotional dataset.
 *
 * DAILY devotional (one reading per day), in the app's GENERALIZED devotional
 * format so multiple devotionals can be offered:
 *   { "MM-DD": { "readings": [ <entry> ] }, ... }   incl. "02-29"
 * Each entry: { label, ref, ho, chapter, verse, text }
 *   - label: "" (single reading per day, no slot label).
 *   - ref:   display reference, e.g. "Isaiah 41:10".
 *   - ho/chapter/verse: app book id + numbers; null when a ref can't be parsed.
 *   - text: opening promise (the quoted verse) as the first paragraph, then the
 *     body paragraphs; paragraphs separated by "\n\n".
 *
 * Source: CCEL ThML (Theological Markup Language) XML — canonical, public domain.
 *   https://ccel.org/ccel/spurgeon/checkbook.xml
 * Cached at /tmp/checkbook.xml (downloaded if absent).
 *
 * The ThML marks each day with:
 *   <p class="Date" ...>Jan. 1</p>
 *   <h3 ...>TITLE</h3>
 *   <p class="VerseQuote" ...>"...promise..." <scripRef osisRef="Bible:Gen.3.15"
 *        parsed="|Gen|3|15|0|0" passage="Gen. 3:15">Gen. 3:15</scripRef></p>
 *   <p ...>body paragraph</p> (one or more)
 * The OSIS book abbreviation (Gen, Ps, Song, 1John, ...) maps 1:1 to the `osis`
 * column in src/lib/osis.ts, so ho/chapter/verse parsing is exact. For a verse
 * range the FIRST verse is taken.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_XML = "/tmp/checkbook.xml";
const SRC_URL = "https://ccel.org/ccel/spurgeon/checkbook.xml";
const OUT_DIR = join(ROOT, "public/data/devotional");
const OUT_FILE = join(OUT_DIR, "faiths-checkbook.json");
const OSIS_TS = join(ROOT, "src/lib/osis.ts");

// --- 1. Ensure source present ---
if (!existsSync(SRC_XML)) {
  console.log("Source missing; downloading checkbook.xml ...");
  execSync(`curl -sL "${SRC_URL}" -o "${SRC_XML}"`, { stdio: "inherit" });
}
const xml = readFileSync(SRC_XML, "utf8");

// --- 2. Build OSIS-abbrev -> {ho,name} map from src/lib/osis.ts ---
const tsSrc = readFileSync(OSIS_TS, "utf8");
const osisToBook = new Map(); // "gen" -> { ho:"GEN", name:"Genesis" }
const nameToBook = new Map(); // "genesis" -> { ho:"GEN", name:"Genesis" }
const tripleRe = /\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g;
let tm;
while ((tm = tripleRe.exec(tsSrc)) !== null) {
  const [, ho, osis, name] = tm;
  osisToBook.set(osis.toLowerCase(), { ho, name });
  nameToBook.set(name.toLowerCase(), { ho, name });
}
if (osisToBook.size < 66) {
  throw new Error(`Parsed only ${osisToBook.size} book mappings from osis.ts — expected 66`);
}
// Printed-name variants (fallback when osisRef is absent/unknown).
const nameVariants = {
  psalm: "Psalms", psalms: "Psalms", canticles: "Song of Solomon",
  "song of songs": "Song of Solomon", "the song of solomon": "Song of Solomon",
};
for (const [k, v] of Object.entries(nameVariants)) {
  const b = nameToBook.get(v.toLowerCase());
  if (b) nameToBook.set(k, b);
}

// --- 3. HTML/entity helpers ---
const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©",
};
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return e in NAMED ? NAMED[e] : m;
  });
}
// Strip tags, decode entities, collapse the source's hard line-wraps/whitespace.
function clean(html) {
  let s = html.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// --- 4. Month name -> number map (source uses mixed abbrev/full forms) ---
const MONTHS = {
  jan: 1, feb: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
function monthNum(word) {
  const w = word.toLowerCase().replace(/\.$/, "");
  return MONTHS[w] ?? null;
}

// --- 5. Locate every day block by its Date marker ---
// A block runs from the end of its Date <p> to the start of the next Date <p>.
// The final block is bounded by the Indexes div (id="xv") so trailing index
// material is never swept into Dec 31.
const dateRe = /<p\b[^>]*class="Date"[^>]*>([\s\S]*?)<\/p>/g;
const markers = [];
let dm;
while ((dm = dateRe.exec(xml)) !== null) {
  const label = clean(dm[1]); // e.g. "Jan. 1", "March 3", "July 9"
  const m = label.match(/^([A-Za-z.]+)\s+(\d{1,2})/);
  markers.push({
    label,
    month: m ? monthNum(m[1]) : null,
    day: m ? Number(m[2]) : null,
    contentStart: dm.index + dm[0].length, // just after the Date <p>
    blockStart: dm.index,
  });
}
const indexStart = (() => {
  const im = xml.match(/<div1\b[^>]*\bid="xv"/);
  return im ? im.index : xml.length;
})();

// Resolve a scripture reference from an osisRef like "Gen.3.15" (first verse of
// a range). Returns { ho, chapter, verse, display } or nulls.
function resolveOsis(osisRefRaw) {
  const first = osisRefRaw.split("-")[0]; // first verse of any range
  const parts = first.split(".");
  const abbr = parts[0];
  const c = Number(parts[1]);
  const v = parts[2] != null ? Number(parts[2]) : null;
  const b = osisToBook.get(abbr.toLowerCase());
  if (!b) return null;
  const chapter = Number.isFinite(c) ? c : null;
  const verse = v != null && Number.isFinite(v) ? v : null;
  let display = b.name;
  if (chapter != null) display += ` ${chapter}`;
  if (verse != null) display += `:${verse}`;
  return { ho: b.ho, chapter, verse, display };
}

// --- 6. Parse each day block ---
const data = {};
const problems = [];
for (let i = 0; i < markers.length; i++) {
  const mk = markers[i];
  const end = i + 1 < markers.length ? markers[i + 1].blockStart : indexStart;
  const block = xml.slice(mk.contentStart, end);

  if (mk.month == null || mk.day == null) {
    problems.push(`Unparseable Date label "${mk.label}"`);
    continue;
  }
  const key = `${String(mk.month).padStart(2, "0")}-${String(mk.day).padStart(2, "0")}`;

  // Walk every <p> in document order: VerseQuote(s) become promise paragraphs
  // (with the trailing scripRef stripped); plain <p> become body paragraphs.
  // The first scripRef supplies ho/chapter/verse + display ref.
  let ho = null, chapter = null, verse = null, ref = null;
  const paras = [];
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let pm;
  while ((pm = pRe.exec(block)) !== null) {
    const attrs = pm[1];
    const inner = pm[2];
    if (/class="Date"/.test(attrs)) continue;
    if (/class="VerseQuote"/.test(attrs)) {
      // Capture ref from the first scripRef of the day.
      if (ref == null) {
        const sr = inner.match(/<scripRef\b([^>]*)>([\s\S]*?)<\/scripRef>/);
        if (sr) {
          const osisM = sr[1].match(/osisRef="Bible:([^"]+)"/);
          const passageM = sr[1].match(/passage="([^"]+)"/);
          const printed = clean(sr[2]);
          if (osisM) {
            const r = resolveOsis(osisM[1]);
            if (r) {
              ho = r.ho; chapter = r.chapter; verse = r.verse; ref = r.display;
            }
          }
          if (ref == null) ref = passageM ? passageM[1] : printed || null;
        }
      }
      // Promise text = the verse quote with its scripRef element removed.
      const promise = clean(inner.replace(/<scripRef\b[^>]*>[\s\S]*?<\/scripRef>/g, ""));
      if (promise) paras.push(promise);
      continue;
    }
    // Plain body paragraph.
    const t = clean(inner);
    if (t) paras.push(t);
  }

  const text = paras.join("\n\n");
  if (!ref) problems.push(`${key}: no scripture reference found`);
  if (!ho) problems.push(`${key}: could not parse ho from ref "${ref}"`);
  if (!text) problems.push(`${key}: empty body`);

  const entry = { label: "", ref, ho, chapter, verse, text };
  if (!data[key]) data[key] = { readings: [] };
  data[key].readings.push(entry);
}

// --- 7. Write output ---
mkdirSync(OUT_DIR, { recursive: true });
const sorted = {};
for (const k of Object.keys(data).sort()) sorted[k] = data[k];
writeFileSync(OUT_FILE, JSON.stringify(sorted, null, 0) + "\n", "utf8");

// --- 8. Report ---
const days = Object.keys(sorted);
const oneReading = days.filter((k) => sorted[k].readings.length === 1);
const nonEmpty = days.filter((k) => sorted[k].readings.every((r) => r.text && r.text.length));
console.log(`Days present: ${days.length}.`);
console.log(`Days with exactly ONE reading: ${oneReading.length}.`);
console.log(`Days where every reading has non-empty text: ${nonEmpty.length}.`);
console.log(`02-29 present: ${!!sorted["02-29"]}.`);
console.log(`Output: ${OUT_FILE}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 50)) console.log("  - " + p);
} else {
  console.log("\nNo problems: every day has one reading with ref, ho, and body text.");
}

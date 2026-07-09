#!/usr/bin/env node
/**
 * Build a public-domain Spurgeon "Morning and Evening" devotional dataset.
 *
 * Source: CCEL ThML (Theological Markup Language) XML — canonical, public domain.
 *   https://ccel.org/ccel/s/spurgeon/morneve.xml
 * Cached at /tmp/morneve.xml (downloaded if absent).
 *
 * The ThML marks every reading as a <div2 id="dMMDD{am|pm}">, and every
 * scripture reference carries both printed text and a machine OSIS ref, e.g.
 *   <scripRef ... osisRef="Bible:Josh.5.12">Joshua 5:12</scripRef>
 * The OSIS book abbreviation (Josh, Ps, Song, 1John, ...) maps 1:1 to the
 * `osis` column in src/lib/osis.ts, so ho/chapter/verse parsing is exact.
 *
 * Output: public/data/devotional/spurgeon.json
 *   { "MM-DD": { "m": <entry>, "e": <entry> }, ... }  incl. "02-29"
 * Each entry: { ref, ho, chapter, verse, text }
 *   - text: opening scripture quote as first line, then body paragraphs,
 *     paragraphs separated by "\n\n".
 *   - ho/chapter/verse: null when a ref cannot be confidently parsed.
 *   - For a verse range, the FIRST verse is taken.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_XML = "/tmp/morneve.xml";
const SRC_URL = "https://ccel.org/ccel/s/spurgeon/morneve.xml";
const OUT_DIR = join(ROOT, "public/data/devotional");
const OUT_FILE = join(OUT_DIR, "spurgeon.json");
const OSIS_TS = join(ROOT, "src/lib/osis.ts");

// --- 1. Ensure source present ---
if (!existsSync(SRC_XML)) {
  console.log("Source missing; downloading morneve.xml ...");
  execSync(`curl -sL "${SRC_URL}" -o "${SRC_XML}"`, { stdio: "inherit" });
}
const xml = readFileSync(SRC_XML, "utf8");

// --- 2. Build OSIS-abbrev -> ho and name -> ho maps from src/lib/osis.ts ---
const tsSrc = readFileSync(OSIS_TS, "utf8");
const osisToHo = new Map(); // "Josh" -> "JOS"
const nameToHo = new Map(); // "song of solomon" -> "SNG"
const tripleRe = /\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g;
let tm;
while ((tm = tripleRe.exec(tsSrc)) !== null) {
  const [, ho, osis, name] = tm;
  osisToHo.set(osis.toLowerCase(), ho);
  nameToHo.set(name.toLowerCase(), ho);
}
if (osisToHo.size < 66) {
  throw new Error(`Parsed only ${osisToHo.size} book mappings from osis.ts — expected 66`);
}
// Common printed-name variants (belt-and-suspenders fallback for ref parsing).
const nameVariants = {
  psalm: "PSA",
  psalms: "PSA",
  canticles: "SNG",
  "song of songs": "SNG",
  songs: "SNG",
  "the song of solomon": "SNG",
};
for (const [k, v] of Object.entries(nameVariants)) nameToHo.set(k, v);

// --- 3. HTML/entity helpers ---
const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  copy: "©",
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

// --- 4. Parse each day/reading block ---
const data = {};
const problems = [];
const blockRe = /<div2\b[^>]*\bid="d(\d{2})(\d{2})(am|pm)"[^>]*>([\s\S]*?)<\/div2>/g;
let bm;
let blocks = 0;
while ((bm = blockRe.exec(xml)) !== null) {
  blocks++;
  const [, mm, dd, ampm, inner] = bm;
  const key = `${mm}-${dd}`;
  const slot = ampm === "am" ? "m" : "e";

  // First scripRef in the block: printed text + machine OSIS ref.
  const srMatch = inner.match(
    /<scripRef\b[^>]*?(?:osisRef="Bible:([^"]+)")?[^>]*>([\s\S]*?)<\/scripRef>/
  );
  let ref = null, ho = null, chapter = null, verse = null;
  if (srMatch) {
    ref = clean(srMatch[2]);
    const osisRefRaw = srMatch[1]; // e.g. "Josh.5.12" or "Ps.63.5-Ps.63.6"
    if (osisRefRaw) {
      const first = osisRefRaw.split("-")[0]; // first verse of a range
      const parts = first.split(".");
      const abbr = parts[0];
      const c = Number(parts[1]);
      const v = parts[2] != null ? Number(parts[2]) : null;
      const mapped = osisToHo.get(abbr.toLowerCase());
      if (mapped) {
        ho = mapped;
        chapter = Number.isFinite(c) ? c : null;
        verse = v != null && Number.isFinite(v) ? v : null;
      }
    }
  }

  // Fallback: parse ho from the printed reference if osisRef was absent/unknown.
  if (!ho && ref) {
    const rm = ref.match(/^((?:[1-3]\s+)?[A-Za-z][A-Za-z.\s]*?)\s+(\d+)(?::(\d+))?/);
    if (rm) {
      const nm = rm[1].toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
      const mapped = nameToHo.get(nm);
      if (mapped) {
        ho = mapped;
        chapter = Number(rm[2]);
        verse = rm[3] != null ? Number(rm[3]) : null;
      }
    }
  }

  // Opening scripture quote (first <p class="passage">).
  let quote = "";
  const pq = inner.match(/<p\b[^>]*class="passage"[^>]*>([\s\S]*?)<\/p>/);
  if (pq) quote = clean(pq[1]);

  // Body paragraphs (<p class="normal">).
  const bodyParas = [];
  const pnRe = /<p\b[^>]*class="normal"[^>]*>([\s\S]*?)<\/p>/g;
  let pm2;
  while ((pm2 = pnRe.exec(inner)) !== null) {
    const t = clean(pm2[1]);
    if (t) bodyParas.push(t);
  }

  const paras = [];
  if (quote) paras.push(quote);
  paras.push(...bodyParas);
  const text = paras.join("\n\n");

  if (!ref) problems.push(`${key} ${slot}: no scripture reference found`);
  if (!ho) problems.push(`${key} ${slot}: could not parse ho from ref "${ref}"`);
  if (bodyParas.length === 0) problems.push(`${key} ${slot}: empty body`);

  if (!data[key]) data[key] = {};
  data[key][slot] = { ref, ho, chapter, verse, text };
}

// --- 5. Write output ---
mkdirSync(OUT_DIR, { recursive: true });
// Sort keys chronologically for a stable, readable file.
const sorted = {};
for (const k of Object.keys(data).sort()) sorted[k] = data[k];
writeFileSync(OUT_FILE, JSON.stringify(sorted, null, 0) + "\n", "utf8");

// --- 6. Report ---
const days = Object.keys(sorted);
const complete = days.filter((k) => sorted[k].m && sorted[k].e);
console.log(`Parsed ${blocks} reading blocks.`);
console.log(`Days present: ${days.length} (expected 366).`);
console.log(`Days with BOTH m and e: ${complete.length}.`);
console.log(`02-29 present: ${!!sorted["02-29"]} (m:${!!sorted["02-29"]?.m} e:${!!sorted["02-29"]?.e})`);
console.log(`Output: ${OUT_FILE}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 50)) console.log("  - " + p);
} else {
  console.log("\nNo problems: every reading has ref, ho, and body text.");
}

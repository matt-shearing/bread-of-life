#!/usr/bin/env node
/**
 * build-oshb.mjs — Build the Old Testament Hebrew word-study dataset from the
 * Open Scriptures Hebrew Bible (OSHB / morphhb, Westminster Leningrad Codex).
 *
 * Source repo (public domain / CC-BY 4.0): https://github.com/openscriptures/morphhb
 * Per-book OSIS XML expected under <MORPHHB>/wlc/<Osis>.xml.
 *
 * Outputs:
 *   public/data/strongs-heb/<HO>.json   — { "chap.verse": [ {w, s}, ... ] }
 *   public/data/strongs/lexicon-heb.json — { "H###": {lemma, xlit, gloss, def} }
 *
 * Re-runnable. Reads the app's own OSIS book mapping from src/lib/osis.ts.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");
const MORPHHB = process.env.MORPHHB_DIR || "/tmp/morphhb";
const WLC_DIR = join(MORPHHB, "wlc");
const SRC_LEXICON = process.env.HEB_LEXICON ||
  "/home/contra/dev/bread-of-life-25/data/strongs/strongs-hebrew.json";

const OUT_WORDS_DIR = join(APP_ROOT, "public/data/strongs-heb");
const OUT_LEXICON = join(APP_ROOT, "public/data/strongs/lexicon-heb.json");

// ---- Read the OT book mapping straight from src/lib/osis.ts (do not modify src) ----
function loadBooks() {
  const txt = readFileSync(join(APP_ROOT, "src/lib/osis.ts"), "utf8");
  const start = txt.indexOf("const RAW");
  const arrStart = txt.indexOf("[", start);
  const arrEnd = txt.indexOf("];", arrStart);
  const body = txt.slice(arrStart, arrEnd);
  // match ["GEN", "Gen", "Genesis"]
  const re = /\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g;
  const books = [];
  let m;
  while ((m = re.exec(body))) books.push({ ho: m[1], osis: m[2], name: m[3] });
  return books; // in canonical order; first 39 are OT
}

// ---- Hebrew normalization: strip cantillation accents + word-internal slash ----
// Cantillation/accent marks live in U+0591..U+05AF. Keep vowel points (nikud).
const CANTILLATION = /[֑-֯]/g;
function normalizeWord(raw) {
  return raw
    .replace(/<[^>]*>/g, "") // any stray inline tags
    .replace(CANTILLATION, "")
    .replace(/\//g, "") // OSHB marks prefix segment boundaries with '/'
    .replace(/[‍‎‏]/g, "")
    .trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ---- Extract the PRIMARY Strong's number from a lemma attribute ----
// Examples: "7225"->7225, "b/7225"->7225, "c/3068"->3068, "9001/430"->430,
//           "1254 a"->1254 (trailing letter dropped). Prefix pseudo-codes are 9xxx.
function primaryStrong(lemma) {
  if (!lemma) return null;
  const segs = lemma.split("/");
  let fallback = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i].trim();
    const mm = seg.match(/(\d+)/); // first run of digits (drops trailing letter)
    if (!mm) continue;
    const n = parseInt(mm[1], 10);
    if (!Number.isFinite(n)) continue;
    if (fallback === null) fallback = n;
    if (n > 0 && n < 9000) return n; // real Strong's (9xxx are prefix codes)
  }
  return fallback; // if everything was a 9xxx code, return the last numeric anyway
}

// ---- Parse one OSHB OSIS book file into { "chap.verse": [ {w, s} ] } ----
const VERSE_RE = /<verse\s+osisID="([^"]+)"\s*>([\s\S]*?)<\/verse>/g;
const WORD_RE = /<w\b([^>]*)>([\s\S]*?)<\/w>/g;
const LEMMA_RE = /\blemma="([^"]*)"/;

function parseBook(xml, osisAbbr, usedStrongs) {
  const out = {};
  let vm;
  VERSE_RE.lastIndex = 0;
  while ((vm = VERSE_RE.exec(xml))) {
    const osisID = vm[1];
    const inner = vm[2];
    const parts = osisID.split(".");
    if (parts[0] !== osisAbbr) continue;
    const key = `${parts[1]}.${parts[2]}`;
    const words = [];
    let wm;
    WORD_RE.lastIndex = 0;
    while ((wm = WORD_RE.exec(inner))) {
      const attrs = wm[1];
      const lm = attrs.match(LEMMA_RE);
      if (!lm) continue;
      const num = primaryStrong(lm[1]);
      if (num == null) continue;
      const s = `H${num}`;
      const w = normalizeWord(decodeEntities(wm[2]));
      if (!w) continue;
      usedStrongs.add(s);
      words.push({ w, s });
    }
    if (words.length) out[key] = words;
  }
  return out;
}

// ---- Main ----
function main() {
  if (!existsSync(WLC_DIR)) {
    console.error(`Missing OSHB source dir: ${WLC_DIR}. Set MORPHHB_DIR or clone morphhb.`);
    process.exit(1);
  }
  const allBooks = loadBooks();
  const otBooks = allBooks.slice(0, 39);

  mkdirSync(OUT_WORDS_DIR, { recursive: true });
  mkdirSync(dirname(OUT_LEXICON), { recursive: true });

  const usedStrongs = new Set();
  let totalVerses = 0;
  let totalTokens = 0;
  let bookFiles = 0;
  let gen11 = null;

  for (const b of otBooks) {
    const src = join(WLC_DIR, `${b.osis}.xml`);
    if (!existsSync(src)) {
      console.warn(`  ! No source XML for ${b.ho} (${b.osis}) at ${src}`);
      continue;
    }
    const xml = readFileSync(src, "utf8");
    const data = parseBook(xml, b.osis, usedStrongs);
    const verses = Object.keys(data);
    totalVerses += verses.length;
    for (const k of verses) totalTokens += data[k].length;
    if (b.ho === "GEN") gen11 = data["1.1"];
    writeFileSync(join(OUT_WORDS_DIR, `${b.ho}.json`), JSON.stringify(data));
    bookFiles++;
  }

  // ---- Build Hebrew lexicon covering every used strong ----
  const srcLex = JSON.parse(readFileSync(SRC_LEXICON, "utf8"));
  const lexicon = {};
  let missing = 0;
  // capture a representative lemma word per strong from the output (fallback)
  const lemmaFromWords = new Map();
  for (const b of otBooks) {
    const f = join(OUT_WORDS_DIR, `${b.ho}.json`);
    if (!existsSync(f)) continue;
    const data = JSON.parse(readFileSync(f, "utf8"));
    for (const k of Object.keys(data)) {
      for (const t of data[k]) if (!lemmaFromWords.has(t.s)) lemmaFromWords.set(t.s, t.w);
    }
  }
  for (const s of [...usedStrongs].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const e = srcLex[s];
    if (e) {
      lexicon[s] = {
        lemma: e.word || lemmaFromWords.get(s) || "",
        xlit: e.transliteration || "",
        gloss: (e.usage || "").trim(),
        def: (e.definition || "").trim(),
      };
    } else {
      missing++;
      lexicon[s] = { lemma: lemmaFromWords.get(s) || "", xlit: "", gloss: "", def: "" };
    }
  }
  writeFileSync(OUT_LEXICON, JSON.stringify(lexicon));

  // ---- Report ----
  function dirSize(dir) {
    let total = 0;
    for (const f of readdirSync(dir)) total += statSync(join(dir, f)).size;
    return total;
  }
  const wordsSize = dirSize(OUT_WORDS_DIR);
  const kb = (n) => (n / 1024).toFixed(1) + " KB";
  const mb = (n) => (n / 1024 / 1024).toFixed(2) + " MB";

  console.log("=== OSHB Hebrew build complete ===");
  console.log(`OT book files written : ${bookFiles}`);
  console.log(`Total verses          : ${totalVerses}`);
  console.log(`Total tokens          : ${totalTokens}`);
  console.log(`Distinct Hebrew strongs: ${usedStrongs.size}`);
  console.log(`lexicon-heb entries   : ${Object.keys(lexicon).length}`);
  console.log(`  strongs missing from source lexicon: ${missing}`);
  console.log(`public/data/strongs-heb size: ${mb(wordsSize)} (${kb(wordsSize)})`);
  console.log("");
  console.log("Genesis 1:1 tokens:");
  for (const t of gen11 || []) console.log(`  ${t.w}  -> ${t.s}`);
  console.log("");
  console.log("lexicon-heb H430 :", JSON.stringify(lexicon["H430"], null, 0));
  console.log("lexicon-heb H7225:", JSON.stringify(lexicon["H7225"], null, 0));
}

main();

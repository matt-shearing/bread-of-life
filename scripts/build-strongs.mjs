#!/usr/bin/env node
// Build a static Strong's word-study dataset for the Bread of Life app.
//
// Inputs:
//   - BSB USFM with Strong's word tags (engbsb_usfm/*.usfm)
//   - Strong's Greek + Hebrew lexicon JSON
// Outputs (public/data/strongs/):
//   - <HO>.json      per-book: { "chapter.verse": [ { w, s }, ... ] }
//   - lexicon.json   { <strongId>: { lemma, xlit, gloss, def } }  (only used ids)

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const USFM_DIR = '/home/contra/dev/bread-of-life-25/bibles/usfm/engbsb_usfm';
const GREEK = '/home/contra/dev/bread-of-life-25/data/strongs/strongs-greek.json';
const HEBREW = '/home/contra/dev/bread-of-life-25/data/strongs/strongs-hebrew.json';
const OUT_DIR = '/home/contra/dev/bread-of-life-2026/public/data/strongs';

const DEF_MAX = 600;

mkdirSync(OUT_DIR, { recursive: true });

// --- helpers ---------------------------------------------------------------

// Normalize a raw strong value ("G1722", "H0430") to the lexicon key form
// ("G1722", "H430") — letter + number with no leading zeros.
function normStrong(raw) {
  const m = /^([GH])0*([0-9]+)([A-Za-z]?)$/.exec(raw.trim());
  if (!m) return null;
  // Keep any letter suffix (e.g. H430a) if present; lexicon here has none but
  // this stays safe if the source ever adds them.
  return `${m[1]}${m[2]}${m[3] || ''}`;
}

function clean(str) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

function trimTo(str, n) {
  const s = clean(str);
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

// --- parse one USFM file into { "c.v": [ {w,s} ] } -------------------------

// Match, in reading order: chapter markers, verse markers, and word tags.
// Word tags handle both \w ... \w* and nested \+w ... \+w* forms.
const TOKEN_RE = /\\c\s+(\d+)|\\v\s+(\d+)|\\\+?w\s+([\s\S]*?)\\\+?w\*/g;

function parseUsfm(text) {
  // Strip footnotes and cross-references so their inner markup is ignored.
  const stripped = text
    .replace(/\\f\b[\s\S]*?\\f\*/g, '')
    .replace(/\\x\b[\s\S]*?\\x\*/g, '');

  const verses = {};
  let chapter = null;
  let key = null;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(stripped)) !== null) {
    if (m[1] !== undefined) {
      chapter = m[1];
    } else if (m[2] !== undefined) {
      key = chapter ? `${chapter}.${m[2]}` : null;
      if (key && !verses[key]) verses[key] = [];
    } else if (m[3] !== undefined && key) {
      const content = m[3];
      // surface word is the text before the first attribute pipe
      const pipe = content.indexOf('|');
      const surface = clean(pipe === -1 ? content : content.slice(0, pipe));
      const sm = /strong="([^"]+)"/i.exec(content);
      if (!surface || !sm) continue; // only emit tagged words
      const s = normStrong(sm[1]);
      if (!s) continue;
      verses[key].push({ w: surface, s });
    }
  }
  return verses;
}

// Derive book id (ho) from a filename like "73-JHNengbsb.usfm" -> "JHN".
function bookId(file) {
  const m = /^\d+-(.+?)engbsb\.usfm$/i.exec(basename(file));
  return m ? m[1].toUpperCase() : null;
}

// --- run over all books ----------------------------------------------------

const files = readdirSync(USFM_DIR).filter((f) => f.toLowerCase().endsWith('.usfm'));
const usedStrongs = new Set();
let bookCount = 0;
let verseCount = 0;
let tokenCount = 0;
const skipped = [];

for (const f of files.sort()) {
  const ho = bookId(f);
  if (!ho) { skipped.push(f); continue; }
  const verses = parseUsfm(readFileSync(join(USFM_DIR, f), 'utf8'));
  const keys = Object.keys(verses);
  if (keys.length === 0) { skipped.push(f); continue; }
  for (const k of keys) {
    verseCount++;
    for (const t of verses[k]) { usedStrongs.add(t.s); tokenCount++; }
  }
  writeFileSync(join(OUT_DIR, `${ho}.json`), JSON.stringify(verses));
  bookCount++;
}

// --- build compact lexicon (only used strong ids) --------------------------

const greek = JSON.parse(readFileSync(GREEK, 'utf8'));
const hebrew = JSON.parse(readFileSync(HEBREW, 'utf8'));

function lookup(id) {
  return id[0] === 'G' ? greek[id] : hebrew[id];
}

const lexicon = {};
let missing = 0;
for (const id of usedStrongs) {
  const e = lookup(id);
  if (!e) { missing++; continue; }
  lexicon[id] = {
    lemma: clean(e.word),                 // original-language word
    xlit: clean(e.transliteration || ''), // transliteration (Greek often blank)
    gloss: trimTo(e.usage, 120),          // short KJV-usage gloss
    def: trimTo(e.definition, DEF_MAX),   // fuller definition
  };
}

writeFileSync(join(OUT_DIR, 'lexicon.json'), JSON.stringify(lexicon));

console.log(JSON.stringify({
  books: bookCount,
  verses: verseCount,
  tokens: tokenCount,
  usedStrongs: usedStrongs.size,
  lexiconEntries: Object.keys(lexicon).length,
  strongsMissingFromLexicon: missing,
  skippedFiles: skipped,
}, null, 2));

/**
 * Behavioural check for the Soul Food plans: mirrors the generation in
 * src/data/plans.ts against the real bundled data and asserts the properties
 * the user actually cares about — every one of the 365 days feeds all four
 * streams (OT, NT, Psalm, Proverb), nothing "cuts off" mid-year, verse
 * portions tile each chapter exactly once, and each once-through stream lands
 * on day 365. Run: node scripts/verify-plans.mjs
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "bible", "bsb");
const index = JSON.parse(await readFile(join(DIR, "index.json"), "utf8"));
const vc = JSON.parse(await readFile(join(DIR, "versification.json"), "utf8"));

const NT_ORDER = index.filter((b) => b.testament === "NT");
const OT_STREAM = index.filter((b) => b.testament === "OT" && b.id !== "PSA" && b.id !== "PRO");
const YEAR = 365;
const range = (n) => Array.from({ length: n }, (_, i) => i);
const sum = (a) => a.reduce((x, y) => x + y, 0);

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) { console.error("  ✗", msg); failures++; }
};

/* ---- replicate plans.ts primitives ---- */
function chaptersFor(books) {
  const out = [];
  for (const b of books) for (let c = 1; c <= b.chapters; c++) out.push({ ho: b.id, chapter: c });
  return out;
}
function chunk(arr, days) {
  const base = Math.floor(arr.length / days), extra = arr.length % days, res = [];
  let i = 0;
  for (let d = 0; d < days; d++) { const n = base + (d < extra ? 1 : 0); if (n > 0) res.push(arr.slice(i, i + n)); i += n; }
  return res;
}
function allocatePortions(weights, portions) {
  const n = weights.length;
  if (portions <= n) return weights.map(() => 1);
  const extra = portions - n, total = sum(weights) || 1;
  const quota = weights.map((w) => (w / total) * extra);
  const base = quota.map(Math.floor);
  let used = sum(base);
  const order = quota.map((q, i) => ({ i, r: q - Math.floor(q) })).sort((a, b) => b.r - a.r);
  let k = 0;
  while (used < extra) { base[order[k % n].i]++; used++; k++; }
  return base.map((b) => b + 1);
}
function splitRanges(verses, parts) {
  const m = Math.max(1, Math.min(parts, verses)), baseLen = Math.floor(verses / m), rem = verses % m, out = [];
  let s = 1;
  for (let j = 0; j < m; j++) { const len = baseLen + (j < rem ? 1 : 0); out.push([s, s + len - 1]); s += len; }
  return out;
}
function versePortions(books, portions) {
  const chapters = [];
  for (const b of books) { const counts = vc[b.id] ?? []; for (let c = 1; c <= counts.length; c++) chapters.push({ ho: b.id, chapter: c, verses: counts[c - 1] }); }
  const alloc = allocatePortions(chapters.map((c) => c.verses), portions);
  const out = [];
  chapters.forEach((c, i) => {
    for (const [a, b] of splitRanges(c.verses, alloc[i]))
      out.push(a === 1 && b === c.verses ? { ho: c.ho, chapter: c.chapter } : { ho: c.ho, chapter: c.chapter, vStart: a, vEnd: b });
  });
  return { out, chapters };
}

const ntCh = chaptersFor(NT_ORDER);
const otChunk = chunk(chaptersFor(OT_STREAM), YEAR);

/* ---- Soul Food Max ---- */
console.log("Soul Food Max:");
const max = range(YEAR).map((i) => [
  ...(otChunk[i] ?? []),
  ntCh[i % ntCh.length],
  { ho: "PSA", chapter: (i % 150) + 1 },
  { ho: "PRO", chapter: (i % 31) + 1 },
]);
ok(max.length === YEAR, `has ${YEAR} days (got ${max.length})`);
let maxBad = 0;
for (const d of max) {
  const hos = new Set(d.map((r) => r.ho));
  const hasOT = d.some((r) => OT_STREAM.find((b) => b.id === r.ho));
  if (!hasOT || !hos.has("PSA") || !hos.has("PRO") || !d.some((r) => NT_ORDER.find((b) => b.id === r.ho))) maxBad++;
}
ok(maxBad === 0, `every day has OT+NT+Psalm+Proverb (bad days: ${maxBad})`);
ok(max.every((d) => d.length >= 4), "every day has ≥4 readings");
console.log(`  first day: ${JSON.stringify(max[0].map(fmt))}`);
console.log(`  last day:  ${JSON.stringify(max[364].map(fmt))}`);

/* ---- Soul Food Classic ---- */
console.log("Soul Food Classic:");
const nt = versePortions(NT_ORDER, YEAR);
const psa = versePortions([{ id: "PSA" }], YEAR);
const pro = versePortions([{ id: "PRO" }], YEAR);
for (const [name, s] of [["NT", nt], ["Psalms", psa], ["Proverbs", pro]]) {
  ok(s.out.length === YEAR, `${name} split into exactly ${YEAR} portions (got ${s.out.length})`);
  // Each chapter fully tiled, in order, no gaps/overlaps.
  const byCh = new Map();
  for (const r of s.out) { const k = `${r.ho}.${r.chapter}`; (byCh.get(k) ?? byCh.set(k, []).get(k)).push([r.vStart ?? 1, r.vEnd ?? vc[r.ho][r.chapter - 1]]); }
  let tileBad = 0;
  for (const c of s.chapters) {
    const parts = byCh.get(`${c.ho}.${c.chapter}`) ?? [];
    let expect = 1;
    for (const [a, b] of parts) { if (a !== expect || b < a) tileBad++; expect = b + 1; }
    if (expect - 1 !== c.verses) tileBad++;
  }
  ok(tileBad === 0, `${name} portions tile every chapter exactly once (bad: ${tileBad})`);
}
const classic = range(YEAR).map((i) => [...(otChunk[i] ?? []), nt.out[i], psa.out[i], pro.out[i]]);
let clBad = 0;
for (const d of classic) if (d.length < 4 || !d.some((r) => r.ho === "PSA") || !d.some((r) => r.ho === "PRO")) clBad++;
ok(clBad === 0, `every Classic day has OT+NT+Psalm+Proverb (bad days: ${clBad})`);
console.log(`  first day: ${JSON.stringify(classic[0].map(fmt))}`);
console.log(`  last day:  ${JSON.stringify(classic[364].map(fmt))}`);
console.log(`  sample splits: ${JSON.stringify([psa.out[6], psa.out[7]].map(fmt))} (Ps 7 split)`);

function fmt(r) { return r.vStart ? `${r.ho} ${r.chapter}:${r.vStart}-${r.vEnd}` : `${r.ho} ${r.chapter}`; }

console.log(failures === 0 ? "\nALL CHECKS PASSED ✓" : `\n${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);

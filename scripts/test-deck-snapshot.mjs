/**
 * Tests for the XENEON Edge deck card's snapshot: the renderer the app uses
 * (src/lib/deckSnapshot.ts) and the one the timer runs while the app is closed
 * (scripts/bol-deck.py) must give the same view of the same source at every moment.
 *
 * Run: node --test-reporter=spec scripts/test-deck-snapshot.mjs
 * Needs Node 23.6+ (imports the TypeScript source directly) and python3.
 */
process.env.TZ = "Australia/Brisbane"; // UTC+10, no DST: local midnight is 14:00 UTC
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { clipVerse, renderDeck } from "../src/lib/deckSnapshot.ts";

const PY = fileURLToPath(new URL("./bol-deck.py", import.meta.url));
const at = (iso) => new Date(iso).getTime(); // local wall time (TZ above)

/** A source written on 23 Oct 2026 at 08:00. */
function source() {
  return {
    source_version: 1,
    written_at_ms: at("2026-10-23T08:00:00"),
    verses: [
      { date: "2026-10-23", ref: "John 15:5", text: "I am the vine and you are the branches.", translation: "BSB" },
      { date: "2026-10-24", ref: "Psalm 23:1", text: "The LORD is my shepherd; I shall not want.", translation: "BSB" },
    ],
    plan: {
      id: "soulfoodClassic",
      name: "Soul Food Classic",
      total_days: 365,
      completed_count: 41,
      next: { day: 41, label: "Genesis 12–14 · Matthew 5:1-12" },
      recent: [
        { day: 40, label: "Genesis 10–11 · Matthew 4", completed_at_ms: at("2026-10-23T07:30:00") },
        { day: 39, label: "Genesis 8–9 · Matthew 3", completed_at_ms: at("2026-10-22T21:00:00") },
      ],
    },
    reading_days: ["2026-10-19", "2026-10-21", "2026-10-22", "2026-10-23"],
    memory: [
      { ref: "Romans 8:28", due_at_ms: at("2026-10-22T09:00:00") },
      { ref: "Philippians 4:6", due_at_ms: at("2026-10-23T12:00:00") },
      { ref: "John 1:1", due_at_ms: at("2026-10-25T09:00:00") },
    ],
    devotion: {
      id: "spurgeon-morning-evening",
      name: "Morning & Evening",
      days: [
        { date: "2026-10-23", readings: [{ label: "Morning", ref: "Psalm 119:49", done: true }, { label: "Evening", ref: "John 6:37", done: false }] },
        { date: "2026-10-24", readings: [{ label: "Morning", ref: "Isaiah 40:31", done: false }, { label: "Evening", ref: "Mark 4:39", done: false }] },
      ],
    },
  };
}

function python(src, now) {
  const dir = mkdtempSync(join(tmpdir(), "bol-deck-"));
  const file = join(dir, "deck-source.json");
  writeFileSync(file, JSON.stringify(src));
  const out = execFileSync("python3", ["-I", PY, "--source", file, "--now", String(now), "--print"], {
    env: { ...process.env, TZ: process.env.TZ },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

test("the morning it was written: today's day done, Morning devotion, memory due", () => {
  const now = at("2026-10-23T09:00:00");
  const d = renderDeck(source(), now);
  assert.equal(d.schema_version, 2);
  assert.equal(d.updated_at_ms, now);
  assert.deepEqual(d.verse, { ref: "John 15:5", text: "I am the vine and you are the branches.", translation: "BSB", source: "verse of the day" });
  assert.deepEqual(d.reading, { plan: "Soul Food Classic", today: "Genesis 10–11 · Matthew 4", done: true, streak_days: 3, day: 41, total_days: 365 });
  assert.deepEqual(d.memory, { due: 1, next_ref: "Romans 8:28", next_due_at_ms: at("2026-10-23T12:00:00") });
  assert.deepEqual(d.devotion, { name: "Morning & Evening", label: "Morning", ref: "Psalm 119:49", done: true });
});

test("the evening: the devotion turns to Evening and the noon card is due", () => {
  const d = renderDeck(source(), at("2026-10-23T17:00:00"));
  assert.deepEqual(d.devotion, { name: "Morning & Evening", label: "Evening", ref: "John 6:37", done: false });
  assert.deepEqual(d.memory, { due: 2, next_ref: "Romans 8:28", next_due_at_ms: at("2026-10-25T09:00:00") });
});

test("after midnight with the app closed: the next day's reading, not done; the streak lives on", () => {
  const d = renderDeck(source(), at("2026-10-24T00:01:00"));
  assert.equal(d.verse?.ref, "Psalm 23:1");
  assert.deepEqual(d.reading, { plan: "Soul Food Classic", today: "Genesis 12–14 · Matthew 5:1-12", done: false, streak_days: 3, day: 42, total_days: 365 });
  assert.equal(d.devotion?.ref, "Isaiah 40:31");
  assert.equal(d.devotion?.done, false);
});

test("past the lookahead: no verse or devotion rather than a stale one; the streak ends", () => {
  const d = renderDeck(source(), at("2026-11-30T09:00:00"));
  assert.equal(d.verse, null);
  assert.equal(d.devotion, null);
  assert.equal(d.reading.streak_days, 0);
  assert.equal(d.memory.due, 3);
  assert.equal(d.memory.next_due_at_ms, null);
});

test("no plan, and a finished plan", () => {
  const none = { ...source(), plan: null };
  assert.deepEqual(renderDeck(none, at("2026-10-23T09:00:00")).reading, { plan: null, today: null, done: false, streak_days: 3, day: null, total_days: null });
  const finished = { ...source(), plan: { ...source().plan, next: null, recent: [] } };
  assert.deepEqual(renderDeck(finished, at("2026-10-23T09:00:00")).reading, { plan: "Soul Food Classic", today: null, done: true, streak_days: 3, day: null, total_days: 365 });
});

test("the Python renderer agrees with the app's at every moment", () => {
  const sources = [source(), { ...source(), plan: null, devotion: null, memory: [] }, { ...source(), plan: { ...source().plan, next: null, recent: [] } }];
  const moments = [
    "2026-10-22T23:59:59", "2026-10-23T00:00:00", "2026-10-23T07:29:59", "2026-10-23T09:00:00", "2026-10-23T12:00:00",
    "2026-10-23T16:59:59", "2026-10-23T17:00:00", "2026-10-23T23:59:59", "2026-10-24T00:00:00", "2026-10-26T10:00:00",
  ].map(at);
  for (const src of sources) for (const now of moments) assert.deepEqual(python(src, now), renderDeck(src, now), new Date(now).toString());
});

test("the timer writes deck.json atomically, mode 0600, and refuses an unknown source", () => {
  const dir = mkdtempSync(join(tmpdir(), "bol-deck-"));
  const src = join(dir, "deck-source.json");
  const out = join(dir, "deck.json");
  writeFileSync(src, JSON.stringify(source()));
  execFileSync("python3", ["-I", PY, "--source", src, "--out", out, "--now", String(at("2026-10-23T09:00:00"))]);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), renderDeck(source(), at("2026-10-23T09:00:00")));
  writeFileSync(src, JSON.stringify({ ...source(), source_version: 99 }));
  assert.throws(() => execFileSync("python3", ["-I", PY, "--source", src, "--out", join(dir, "other.json")], { stdio: "pipe" }));
});

test("clipVerse keeps one verse within 280 characters, cut at a word", () => {
  assert.equal(clipVerse("  In the   beginning\nwas the Word. "), "In the beginning was the Word.");
  const long = "word ".repeat(100);
  const c = clipVerse(long);
  assert.ok(c.length <= 280, String(c.length));
  assert.ok(c.endsWith("word…"));
});

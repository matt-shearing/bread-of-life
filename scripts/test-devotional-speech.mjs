/**
 * Tests for the devotional speech normaliser (src/lib/devotionalSpeech.ts), the TypeScript
 * port of the one in scripts/build-devotional-audio.py. The phone's own voice, used when a
 * recording is missing, must say the same words as the recording, so the two are compared
 * line by line, pauses included.
 *
 * Run: pnpm test:devotional-speech   (or: node scripts/test-devotional-speech.mjs)
 *
 * By default it compares against scripts/fixtures/devotional-speech.txt, the Python
 * script's `--print-text` output for twelve days chosen to exercise every rule (numbered
 * heads, bracketed glosses, "(read …)", years, "William III", "viz.", "Song of Sol.",
 * shouted capitals, 29 February). Regenerate it after changing the Python normaliser:
 *
 *   python scripts/build-devotional-audio.py --print-text \
 *     --days 01-01,02-09,02-29,04-07,06-13,08-08,08-14,09-25,11-05,12-02,12-17,12-26 \
 *     > scripts/fixtures/devotional-speech.txt
 *
 * Set BOL_DEVAUDIO_PYTHON to the devotional-audio venv's python to compare all 732
 * readings against the live script instead (needs no model for --print-text).
 *
 * Needs Node 23.6+ (imports the TypeScript source directly; Node strips the types).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
const {
  buildSpeechScript,
  formatScript,
  normalise,
  speakKeyRef,
  dateWords,
  numWords,
  ordinalWords,
  splitLong,
} = await import(new URL("../src/lib/devotionalSpeech.ts", import.meta.url).href);

const data = JSON.parse(readFileSync(`${root}public/data/devotional/spurgeon.json`, "utf8"));

function pythonText() {
  const py = process.env.BOL_DEVAUDIO_PYTHON;
  if (!py) return { source: "scripts/fixtures/devotional-speech.txt", text: readFileSync(`${root}scripts/fixtures/devotional-speech.txt`, "utf8") };
  const r = spawnSync(py, ["scripts/build-devotional-audio.py", "--print-text"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`python --print-text failed:\n${r.stderr}`);
  return { source: `${py} --print-text (all days)`, text: r.stdout };
}

const { source, text } = pythonText();
const blocks = text.split(/\n(?=### )/).filter((b) => b.startsWith("### "));

test(`matches the Python script line for line (${blocks.length} readings from ${source})`, () => {
  assert.ok(blocks.length >= 20, `expected at least 20 readings, got ${blocks.length}`);
  for (const block of blocks) {
    const [slot, day] = block.split("\n")[0].slice(4).split("/");
    const want = block.trimEnd().split("\n");
    const got = formatScript(day, slot, buildSpeechScript(day, slot, data[day][slot[0]])).trimEnd().split("\n");
    for (let i = 0; i < Math.max(want.length, got.length); i++) {
      assert.equal(got[i], want[i], `${slot}/${day}, line ${i}`);
    }
  }
});

test("the three days the brief names read as the recording does", () => {
  const days = new Set(blocks.map((b) => b.split("\n")[0].slice(4)));
  for (const id of ["morning/01-01", "evening/01-01", "morning/09-25", "evening/09-25", "morning/12-17", "evening/12-17"]) {
    assert.ok(days.has(id), `${id} is in the comparison`);
  }
});

test("heading and key reference", () => {
  const segs = buildSpeechScript("09-25", "morning", data["09-25"].m);
  assert.equal(segs[0].text, "Morning, September the twenty-fifth.");
  assert.equal(segs[1].text, "Romans chapter three, verse twenty-six.");
  assert.equal(segs[0].pause, 0.7);
  assert.equal(segs[2].pause, 1.1, "longer pause after the key verse");
  assert.equal(segs[segs.length - 1].pause, 0.6, "tail");
});

test("scripture references are spoken out", () => {
  assert.equal(speakKeyRef("2 Ch. 20:37"), "Second Chronicles chapter twenty, verse thirty-seven");
  assert.equal(speakKeyRef("Psalm 23:1"), "Psalm twenty-three, verse one");
  assert.equal(speakKeyRef("Jude 24"), "Jude, verse twenty-four");
  assert.equal(normalise("as Jacob did (Gen. 32:24-30) at Peniel"), "as Jacob did, Genesis chapter thirty-two, verses twenty-four to thirty, at Peniel");
  assert.equal(speakKeyRef("not a reference"), "not a reference", "an unparseable heading is read, not thrown");
});

test("abbreviations, years, capitals and dashes", () => {
  assert.equal(normalise("Mr. Jay, viz. the Dr. of St. Paul's"), "Mister Jay, namely, the Doctor of Saint Paul's");
  assert.equal(normalise("in 1688 William III came"), "in sixteen eighty-eight William the Third came");
  assert.equal(normalise("TAKE THE WATER OF LIFE FREELY, for I AM"), "Take The Water Of Life Freely, for I Am");
  assert.equal(normalise("grace—free grace—and more"), "grace, free grace, and more");
});

test("numbers and dates", () => {
  assert.equal(numWords(0), "zero");
  assert.equal(numWords(119), "one hundred and nineteen");
  assert.equal(numWords(1005), "one thousand and five");
  assert.equal(ordinalWords(21), "twenty-first");
  assert.equal(ordinalWords(30), "thirtieth");
  assert.equal(ordinalWords(12), "twelfth");
  assert.equal(dateWords("02-29"), "February the twenty-ninth");
});

test("long sentences split under the chunk limit", () => {
  const long = Array.from({ length: 30 }, (_, i) => `clause number ${i} goes here`).join(", ") + ".";
  const chunks = splitLong(long);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 280, `chunk of ${c.length}`);
  assert.equal(chunks.join(" "), long);
});

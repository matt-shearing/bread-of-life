/**
 * Tests for the typed-reference parser (src/lib/reference.ts), which powers "Go to"
 * on the Search page and the Ctrl+K palette.
 *
 * Run: pnpm test:reference   (or: node --test-reporter=spec scripts/test-reference.mjs)
 * Needs Node 23.6+ (imports the TypeScript source directly; Node strips the types).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReference, formatReference, findBook } from "../src/lib/reference.ts";

// [typed, expected label] — the label pins book, chapter, verse and range at once.
const GOOD = [
  ["jn 3:16", "John 3:16"],
  ["John 3:16", "John 3:16"],
  ["john 3 16", "John 3:16"],
  ["jn 3.16", "John 3:16"],
  ["Jn. 3:16", "John 3:16"],
  ["JHN 3:16", "John 3:16"],
  ["John 3", "John 3"],
  ["John 3 v 16", "John 3:16"],
  ["john 3:16a", "John 3:16"],
  ["John 3:16-18", "John 3:16-18"],
  ["John 3:16–18", "John 3:16-18"], // en dash
  ["John 3:16—18", "John 3:16-18"], // em dash
  ["John 3:16 to 18", "John 3:16-18"],
  ["John 3:16-4:2", "John 3:16-4:2"],
  ["1 Cor 13:4-7", "1 Corinthians 13:4-7"],
  ["1cor13:4-7", "1 Corinthians 13:4-7"],
  ["1 Corinthians 13", "1 Corinthians 13"],
  ["I Corinthians 13", "1 Corinthians 13"],
  ["First Corinthians 13:13", "1 Corinthians 13:13"],
  ["2 cor 5:17", "2 Corinthians 5:17"],
  ["II Kings 2", "2 Kings 2"],
  ["2kgs 2:11", "2 Kings 2:11"],
  ["1 Sam 17", "1 Samuel 17"],
  ["1sa 3:10", "1 Samuel 3:10"],
  ["1 chron 29:11", "1 Chronicles 29:11"],
  ["1jn1:9", "1 John 1:9"],
  ["1 jn 1:9", "1 John 1:9"],
  ["I John 4:8", "1 John 4:8"],
  ["III John 2", "3 John 1:2"], // one-chapter book: the number is a verse
  ["3 jn 4", "3 John 1:4"],
  ["Jude 5", "Jude 1:5"],
  ["jude 3-5", "Jude 1:3-5"],
  ["Philemon 6", "Philemon 1:6"],
  ["Obadiah 1:15", "Obadiah 1:15"],
  ["Ps 23", "Psalm 23"],
  ["Psalm 23:1", "Psalm 23:1"],
  ["psalms 119:105", "Psalm 119:105"],
  ["Ps. 119:105", "Psalm 119:105"],
  ["psa 1", "Psalm 1"],
  ["Song of Songs 2", "Song of Solomon 2"],
  ["Song of Solomon 2:4", "Song of Solomon 2:4"],
  ["SoS 1", "Song of Solomon 1"],
  ["Gen 1", "Genesis 1"],
  ["gn 1:1", "Genesis 1:1"],
  ["Genesis 1-3", "Genesis 1-3"],
  ["genes 50:20", "Genesis 50:20"], // unique prefix
  ["Ex 20", "Exodus 20"],
  ["Deut 6:4-9", "Deuteronomy 6:4-9"],
  ["Is 53:5", "Isaiah 53:5"],
  ["isa 40:31", "Isaiah 40:31"],
  ["Jer 29:11", "Jeremiah 29:11"],
  ["Ezek 37", "Ezekiel 37"],
  ["Mt 5:3-12", "Matthew 5:3-12"],
  ["mk 1", "Mark 1"],
  ["lk 15:11", "Luke 15:11"],
  ["Rom 8:28", "Romans 8:28"],
  ["phil 4:13", "Philippians 4:13"],
  ["php 4:6", "Philippians 4:6"],
  ["Heb 11:1", "Hebrews 11:1"],
  ["Jas 1:5", "James 1:5"],
  ["1 pet 5:7", "1 Peter 5:7"],
  ["Rev 21:4", "Revelation 21:4"],
  ["Revelations 22", "Revelation 22"],
  ["Prov 3:5-6", "Proverbs 3:5-6"],
  ["Eccl 3:1", "Ecclesiastes 3:1"],
  ["  romans 12:2  ", "Romans 12:2"],
  ["Romans", "Romans"], // book only
];

const BAD = ["love", "", "   ", "grace and peace", "John 30", "Ps 151", "Jude 2:1", "hello 3:16", "3:16", "John 3:0", "Gen 3-1", "jo 3:16", "ph 1"];

for (const [typed, label] of GOOD) {
  test(`parses ${JSON.stringify(typed)} → ${label}`, () => {
    const r = parseReference(typed);
    assert.ok(r, `expected a reference from ${JSON.stringify(typed)}`);
    assert.equal(formatReference(r), label);
  });
}

for (const typed of BAD) {
  test(`rejects ${JSON.stringify(typed)}`, () => {
    assert.equal(parseReference(typed), null);
  });
}

test("exact fields for 1 Cor 13:4-7", () => {
  assert.deepEqual(parseReference("1 Cor 13:4-7"), { ho: "1CO", chapter: 13, verse: 4, verseEnd: 7 });
});

test("book-only is flagged and opens chapter 1", () => {
  assert.deepEqual(parseReference("Romans"), { ho: "ROM", chapter: 1, bookOnly: true });
});

test("findBook covers every book by full name and OSIS id", async () => {
  const { BOOKS } = await import("../src/lib/osis.ts");
  for (const b of BOOKS) {
    assert.equal(findBook(b.name)?.ho, b.ho, b.name);
    assert.equal(findBook(b.osis)?.ho, b.ho, b.osis);
  }
});

test(`at least 40 reference forms covered (${GOOD.length})`, () => {
  assert.ok(GOOD.length >= 40);
});

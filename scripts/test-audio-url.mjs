/**
 * The app and Android Auto must build the same narration URL for a chapter. This checks the
 * TypeScript builder (src/audio/audioUrl.ts) against the shared fixture that the Kotlin test
 * (AudioUrlAgreementTest.kt) also reads, and against every URL in the bundled Bible.
 *
 * Run: pnpm test:audio-url   (Node 23.6+, imports the TypeScript source directly)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { chapterAudioUrl, parseChapterAudioUrl } from "../src/audio/audioUrl.ts";

const root = new URL("../", import.meta.url);

test("TypeScript builds the fixture's URLs (the Kotlin test checks the same file)", () => {
  const { cases } = JSON.parse(readFileSync(new URL("src/audio/audio-url-cases.json", root), "utf8"));
  assert.ok(cases.length >= 5);
  for (const c of cases) {
    assert.equal(chapterAudioUrl(c.ho, c.chapter, c.narrator), c.url);
    assert.deepEqual(parseChapterAudioUrl(c.url), { ho: c.ho, chapter: c.chapter, narrator: c.narrator });
  }
});

test("every chapter's bundled narration URL is the pattern", () => {
  const dir = new URL("public/bible/bsb/", root);
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (!/^[0-9A-Z]{3}\.json$/.test(f)) continue;
    const ho = f.slice(0, 3);
    const book = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    for (const ch of book.chapters) {
      for (const [narrator, url] of Object.entries(ch.audio ?? {})) {
        assert.equal(chapterAudioUrl(ho, ch.number, narrator), url, `${ho} ${ch.number} ${narrator}`);
        n++;
      }
    }
  }
  assert.equal(n, 1189 * 3, "all 1,189 chapters, three narrators each");
});

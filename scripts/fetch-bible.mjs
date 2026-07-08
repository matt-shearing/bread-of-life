#!/usr/bin/env node
// Fetch real Berean Standard Bible (public domain / CC0) from the HelloAO
// Free Use Bible API and normalise it into compact per-book JSON that the
// reader consumes directly. This is our "USFM->JSON, static wins" pipeline,
// except HelloAO already gives clean structured JSON so there is no parsing
// guesswork. Re-runnable and offline-friendly after first run.
//
//   node scripts/fetch-bible.mjs
//
// Source: https://bible.helloao.org  (no API key, no rate limit, no license
// restriction — BSB itself is CC0 public domain).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "bible", "bsb");
const API = "https://bible.helloao.org/api";
const TRANSLATION = "BSB";

/** Flatten HelloAO verse/heading content arrays into a plain string. */
function flatten(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const item of content) {
    if (typeof item === "string") parts.push(item);
    else if (item && typeof item === "object") {
      if (typeof item.text === "string") parts.push(item.text);
      // ignore footnote refs / poetry markers for v1; lineBreak -> space
      else if (item.lineBreak) parts.push(" ");
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log("Downloading complete BSB (~7MB)…");
  const complete = await getJSON(`${API}/${TRANSLATION}/complete.json`);

  // complete.json shape: { translation, books: [{ ...book, chapters: [{ number, content:[...] }] }] }
  const books = complete.books ?? complete;
  const index = [];

  for (const book of books) {
    const order = book.order ?? book.book?.order ?? index.length + 1;
    const testament = order <= 39 ? "OT" : "NT";
    const chapters = (book.chapters ?? []).map((wrap) => {
      // complete.json nests the real chapter under `.chapter`, with audio
      // links as a sibling. Per-chapter endpoints are flatter; support both.
      const ch = wrap.chapter ?? wrap;
      const items = [];
      for (const node of ch.content ?? []) {
        if (node.type === "heading") {
          const text = flatten(node.content);
          if (text) items.push({ t: "h", text });
        } else if (node.type === "verse") {
          items.push({ t: "v", n: node.number, text: flatten(node.content) });
        }
        // skip line_break / hebrew_subtitle nodes for v1
      }
      const audio = wrap.thisChapterAudioLinks;
      return audio ? { number: ch.number, items, audio } : { number: ch.number, items };
    });

    const id = book.id ?? book.book?.id;
    const name = book.commonName ?? book.name ?? book.title ?? id;
    const outBook = { id, name, order, testament, chapters };
    await writeFile(join(OUT, `${id}.json`), JSON.stringify(outBook));
    index.push({
      id,
      name,
      order,
      testament,
      chapters: chapters.length,
      verses: chapters.reduce((s, c) => s + c.items.filter((i) => i.t === "v").length, 0),
    });
    process.stdout.write(`  ${id} (${chapters.length} ch)\n`);
  }

  index.sort((a, b) => a.order - b.order);
  await writeFile(join(OUT, "index.json"), JSON.stringify(index, null, 2));
  console.log(`\nDone. ${index.length} books -> public/bible/bsb/`);
}

main().catch((e) => {
  console.error("fetch-bible failed:", e);
  process.exit(1);
});

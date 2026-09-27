/**
 * Tests for the licensed-translation layer (src/data/licensed/): the capped cache that
 * keeps us inside each publisher's storage limits, the ESV, NLT and API.Bible parsers
 * and requests (HTTP is faked — no real keys), FUMS reporting, the notices, and the
 * attribution added to copied verses.
 *
 * Run: node --test-reporter=spec scripts/test-licensed-translations.mjs
 * Needs Node 23.6+ (imports the TypeScript sources directly).
 *
 * The fixtures copy each API's real markup, but the words in them are the public-domain
 * BSB: a test file in a public repository is no place for copyrighted text.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, statSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const withExt = (p) => {
  for (const c of [p, `${p}.ts`, `${p}.tsx`, `${p}/index.ts`]) if (existsSync(c) && statSync(c).isFile()) return c;
  return p;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@tauri-apps/plugin-http") {
      return { url: "data:text/javascript,export const fetch = () => { throw new Error('no network in tests'); };", shortCircuit: true };
    }
    let target = null;
    if (specifier.startsWith("@/")) target = withExt(SRC + specifier.slice(2));
    else if (specifier.startsWith(".") && context.parentURL?.includes("/src/")) {
      target = withExt(fileURLToPath(new URL(specifier, context.parentURL)));
    }
    if (target) return { url: pathToFileURL(target).href, shortCircuit: true, format: "module-typescript" };
    return next(specifier, context);
  },
});

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const cache = await import("../src/data/licensed/cache.ts");
const esv = await import("../src/data/licensed/esv.ts");
const nlt = await import("../src/data/licensed/nlt.ts");
const apibible = await import("../src/data/licensed/apibible.ts");
const fums = await import("../src/data/licensed/fums.ts");
const catalog = await import("../src/data/licensed/catalog.ts");
const licensed = await import("../src/data/licensed/index.ts");
const bible = await import("../src/data/bible.ts");
const { citation } = await import("../src/lib/quote.ts");
const { useUI } = await import("../src/store/ui.ts");

/** A fake fetch: records every call and answers from `handler(url, init)`. */
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.json,
      text: async () => r.text ?? JSON.stringify(r.json),
    };
  };
  f.calls = calls;
  return f;
}

const verses = (ch) => ch.items.filter((i) => i.t === "v");

/* ------------------------------------ cache ------------------------------------ */

test("the cache evicts the least recently read rows to stay under the verse cap", async () => {
  const store = cache.memoryCacheStore();
  const policy = { maxVerses: 100 };
  const put = (k, n, t) => cache.writeCapped(store, "lic:ESV:", { key: `lic:ESV:${k}`, json: k, verses: n }, policy, t);
  await put("GEN.1", 31, 1);
  await put("GEN.2", 25, 2);
  await put("EXO.1", 22, 3);
  // Reading GEN.1 again makes GEN.2 the oldest.
  assert.equal(await cache.readCapped(store, "lic:ESV:GEN.1", policy, 4), "GEN.1");
  await put("EXO.2", 25, 5); // 31+25+22+25 = 103 > 100
  assert.deepEqual([...store.map.keys()].sort(), ["lic:ESV:EXO.1", "lic:ESV:EXO.2", "lic:ESV:GEN.1"]);
  const total = [...store.map.values()].reduce((n, r) => n + r.verses, 0);
  assert.ok(total <= 100, `holds ${total} verses`);
});

test("the cache never holds more than half of a book, and never a chapter bigger than that", async () => {
  const store = cache.memoryCacheStore();
  const policy = { maxVerses: 500, maxBookShare: 0.5 };
  // Haggai: 38 verses, so at most 19 at once. Chapter 1 has 15, chapter 2 has 23.
  assert.equal(await cache.writeCapped(store, "lic:ESV:", { key: "lic:ESV:HAG.1", json: "1", verses: 15 }, policy, 1, 38), true);
  assert.equal(await cache.writeCapped(store, "lic:ESV:", { key: "lic:ESV:HAG.2", json: "2", verses: 23 }, policy, 2, 38), false);
  assert.deepEqual([...store.map.keys()], ["lic:ESV:HAG.1"]);
  // Jude is one chapter, so it can never be kept.
  assert.equal(await cache.writeCapped(store, "lic:ESV:", { key: "lic:ESV:JUD.1", json: "j", verses: 25 }, policy, 3, 25), false);
  // Joel: 73 verses (cap 36). Chapters of 20 + 32 would be 52, so the older one goes.
  await cache.writeCapped(store, "lic:ESV:", { key: "lic:ESV:JOL.1", json: "a", verses: 20 }, policy, 4, 73);
  await cache.writeCapped(store, "lic:ESV:", { key: "lic:ESV:JOL.2", json: "b", verses: 32 }, policy, 5, 73);
  assert.ok(!store.map.has("lic:ESV:JOL.1") && store.map.has("lic:ESV:JOL.2"));
  assert.ok(store.map.has("lic:ESV:HAG.1"), "other books are untouched");
});

test("stale rows are dropped and refetched", async () => {
  const store = cache.memoryCacheStore();
  const policy = { maxVerses: 500, maxAgeMs: cache.DAYS(30) };
  await cache.writeCapped(store, "lic:x:", { key: "lic:x:JHN.3", json: "old", verses: 36 }, policy, 0);
  assert.equal(await cache.readCapped(store, "lic:x:JHN.3", policy, cache.DAYS(29)), "old");
  assert.equal(await cache.readCapped(store, "lic:x:JHN.3", policy, cache.DAYS(31)), undefined);
  assert.equal(store.map.size, 0);
});

test("the provider caps follow the publishers' terms", () => {
  for (const p of [esv.ESV_POLICY, nlt.NLT_POLICY, apibible.APIBIBLE_POLICY]) {
    assert.ok(p.maxVerses <= 500, "Crossway and Tyndale: 500 verses; Lockman allows 1,000");
    assert.equal(p.maxBookShare, 0.5, "never half a book or more");
    assert.ok(p.maxAgeMs <= cache.DAYS(30), "API.Bible: refresh at least every 30 days");
  }
});

/* ------------------------------------- ESV ------------------------------------- */

const ESV_HTML = `<h3 id="p43003001_01-1">You Must Be Born Again</h3>
<p id="p43003001_01-1" class="starts-chapter"><b class="chapter-num" id="v43003001-1">3:1&nbsp;</b>Now there was a Pharisee named Nicodemus, a leader of the Jews. <b class="verse-num" id="v43003002-1">2&nbsp;</b>He came to Jesus at night and said, &ldquo;Rabbi, we know that You are a teacher who has come from God.&rdquo;<sup class="footnote"><a class="fn" href="#f1-">1</a></sup></p>
<h3 id="p43003016_01-1">For God So Loved the World</h3>
<p id="p43003016_01-1"><b class="verse-num" id="v43003016-1">16&nbsp;</b>For God so loved the world that He gave His one and only Son,</p>
<p class="block-indent"><span class="line">that everyone who believes in Him shall not perish</span><br /><span class="line">but have eternal life. The <span class="divine-name">Lord</span> is faithful.</span></p>`;

test("ESV: the request asks for the chapter by name, with the key in the Authorization header", async () => {
  const f = fakeFetch(() => ({ json: { canonical: "John 3", passages: [ESV_HTML] } }));
  const r = await esv.fetchEsvChapter(f, "abc123", { name: "John" }, 3);
  const u = new URL(f.calls[0].url);
  assert.equal(u.origin + u.pathname, "https://api.esv.org/v3/passage/html/");
  assert.equal(u.searchParams.get("q"), "John 3");
  assert.equal(u.searchParams.get("include-footnotes"), "false");
  assert.equal(f.calls[0].init.headers.Authorization, "Token abc123");
  assert.equal(verses(r.chapter).length, 3);
  // A one-chapter book is asked for by name alone ("Jude 1" would be one verse).
  assert.equal(esv.esvQuery({ name: "Jude", chapters: 1 }, 1), "Jude");
});

test("ESV: headings, verse text, poetry lines and LORD come out right; footnote markers do not", () => {
  const ch = esv.parseEsvHtml(ESV_HTML, 3);
  assert.deepEqual(
    ch.items.map((i) => (i.t === "h" ? `# ${i.text}` : `${i.n} ${i.text}`)),
    [
      "# You Must Be Born Again",
      "1 Now there was a Pharisee named Nicodemus, a leader of the Jews.",
      "2 He came to Jesus at night and said, “Rabbi, we know that You are a teacher who has come from God.”",
      "# For God So Loved the World",
      "16 For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life. The LORD is faithful.",
    ],
  );
});

test("ESV: a refused key, a throttle and no network each say why", async () => {
  for (const [status, why] of [[401, "bad-key"], [403, "not-licensed"], [429, "rate-limited"], [500, "offline"]]) {
    const f = fakeFetch(() => ({ status, json: { detail: "no" } }));
    await assert.rejects(esv.fetchEsvChapter(f, "k", { name: "John" }, 3), (e) => e.failure === why);
  }
  await assert.rejects(
    esv.fetchEsvChapter(async () => {
      throw new TypeError("Failed to fetch");
    }, "k", { name: "John" }, 3),
    (e) => e.failure === "offline",
  );
  await assert.rejects(esv.fetchEsvChapter(fakeFetch(() => ({})), "", { name: "John" }, 3), (e) => e.failure === "no-key");
});

test("ESV: the notice is Crossway's wording, links to esv.org, and a page may hold half a book", () => {
  assert.match(esv.ESV_NOTICE, /^Scripture quotations are from the ESV® Bible \(The Holy Bible, English Standard Version®\), © 2001 by Crossway/);
  assert.equal(licensed.ESV_TRANSLATION.noticeUrl, "https://www.esv.org");
  assert.equal(licensed.ESV_TRANSLATION.maxBookShareOnPage, 0.5);
});

/* ------------------------------------- NLT ------------------------------------- */

const NLT_HTML = `<!DOCTYPE html><html><body><div id="bibletext"><section><h2 class="bk_ch_vs_header">Psalm 23:1-2, NLT</h2><verse_export orig="psal_23_1" bk="psal" ch="23" vn="1">
<h3 class="chapter-number"><span class="cw">Psalm</span> <span class="cw_ch">23</span></h3>
<h4 class="subhead">The <span class="subhead-sc">Lord</span> Is My Shepherd</h4>
<p class="psa-title">A Psalm of David.</p>
<p class="poet1-vn-sp"><span class="vn">1</span>The <span class="sc">Lord</span> is my shepherd;</p>
<p class="poet2">I shall not want.<a class="a-tn">*</a><span class="tn"><span class="tn-ref">23:1</span> Or <em>lack nothing.</em></span></p>
</verse_export><verse_export orig="psal_23_2" bk="psal" ch="23" vn="2">
<p class="poet1-vn"><span class="vn">2</span>He makes me lie down in green pastures;</p>
<p class="poet2">He leads me beside quiet waters.</p>
</verse_export></section></div></body></html>`;

test("NLT: verses, headings and a psalm title are parsed; notes and the banner are dropped", () => {
  const ch = nlt.parseNltHtml(NLT_HTML, 23);
  assert.deepEqual(
    ch.items.map((i) => (i.t === "h" ? `# ${i.text}` : `${i.n} ${i.text}`)),
    ["# The LORD Is My Shepherd", "# A Psalm of David.", "1 The LORD is my shepherd; I shall not want.", "2 He makes me lie down in green pastures; He leads me beside quiet waters."],
  );
});

test("NLT: the request names the book the way the API does and carries the key", async () => {
  const f = fakeFetch(() => ({ text: NLT_HTML }));
  await nlt.fetchNltChapter(f, "nltkey", "Psalms", 23);
  const u = new URL(f.calls[0].url);
  assert.equal(u.origin + u.pathname, "https://api.nlt.to/api/passages");
  assert.equal(u.searchParams.get("ref"), "Psalms 23");
  assert.equal(u.searchParams.get("key"), "nltkey");
  assert.equal(new URL(nlt.nltUrl("Song of Solomon", 2, "k")).searchParams.get("ref"), "Song of Songs 2");
  assert.match(nlt.NLT_NOTICE, /Tyndale House Foundation\. Used by permission of Tyndale House Publishers/);
});

/* ---------------------------------- API.Bible ---------------------------------- */

const t = (text, verseId) => ({ text, type: "text", attrs: verseId ? { verseId, verseOrgIds: [verseId] } : {} });
const APIBIBLE_JSON = {
  data: {
    id: "JHN.3",
    reference: "John 3",
    copyright: "  New American Standard Bible®   Copyright © 1960, 1971, 1977, 1995, 2020 by The Lockman Foundation. ",
    content: [
      { name: "para", type: "tag", attrs: { style: "s1" }, items: [t("You Must Be Born Again")] },
      {
        name: "para",
        type: "tag",
        attrs: { style: "p" },
        items: [
          { name: "verse", type: "tag", attrs: { number: "1", style: "v", sid: "JHN 3:1" }, items: [t("1")] },
          t("Now there was a Pharisee named Nicodemus, ", "JHN.3.1"),
          { name: "char", type: "tag", attrs: { style: "wj" }, items: [t("a leader of the Jews.", "JHN.3.1")] },
          { name: "note", type: "tag", attrs: { style: "f" }, items: [t("a note that is never shown", "JHN.3.1")] },
          { name: "verse", type: "tag", attrs: { number: "2", style: "v", sid: "JHN 3:2" }, items: [t("2")] },
          t("He came to Jesus at night.", "JHN.3.2"),
        ],
      },
      { name: "para", type: "tag", attrs: { style: "q1" }, items: [t("and he said,", "JHN.3.2")] },
    ],
  },
  meta: { fumsToken: "TOKEN-123" },
};

test("API.Bible: chapter JSON becomes verses and headings; the copyright and FUMS token come back", async () => {
  const f = fakeFetch(() => ({ json: APIBIBLE_JSON }));
  const r = await apibible.fetchApiBibleChapter(f, "abkey", "a761ca71e0b3ddcf-01", "JHN", 3);
  const u = new URL(f.calls[0].url);
  assert.equal(u.origin, "https://api.scripture.api.bible");
  assert.equal(u.pathname, "/v1/bibles/a761ca71e0b3ddcf-01/chapters/JHN.3");
  assert.equal(u.searchParams.get("content-type"), "json");
  assert.equal(u.searchParams.get("fums-version"), "3");
  assert.equal(f.calls[0].init.headers["api-key"], "abkey");
  assert.deepEqual(
    r.chapter.items.map((i) => (i.t === "h" ? `# ${i.text}` : `${i.n} ${i.text}`)),
    ["# You Must Be Born Again", "1 Now there was a Pharisee named Nicodemus, a leader of the Jews.", "2 He came to Jesus at night. and he said,"],
  );
  assert.equal(r.chapter.copyright, "New American Standard Bible® Copyright © 1960, 1971, 1977, 1995, 2020 by The Lockman Foundation.");
  assert.equal(r.fumsToken, "TOKEN-123");
});

test("API.Bible: the key's English Bibles are listed", async () => {
  const f = fakeFetch(() => ({
    json: { data: [{ id: "b8ee27bcd1cae43a-01", abbreviation: "NASB1995", name: "New American Standard Bible 1995" }, { id: "x", abbreviationLocal: "WEB", nameLocal: "World English Bible" }] },
  }));
  const list = await apibible.listApiBibles(f, "k");
  assert.equal(new URL(f.calls[0].url).searchParams.get("language"), "eng");
  assert.deepEqual(list.map((b) => b.abbreviation), ["NASB1995", "WEB"]);
});

test("API.Bible: Lockman texts carry Lockman's own notice, linked to lockman.org, plus the API.Bible credit", () => {
  const nasb = licensed.apiBibleTranslation({ id: "a761ca71e0b3ddcf-01", abbreviation: "NASB", name: "New American Standard Bible 2020" });
  assert.match(nasb.notice, /Copyright © 1960, 1971, 1977, 1995, 2020 by The Lockman Foundation\. Used by permission\. All rights reserved\. www\.Lockman\.org$/);
  assert.equal(nasb.noticeUrl, "https://www.lockman.org");
  assert.equal(nasb.copyNotice, nasb.notice);
  assert.deepEqual(nasb.credit, { label: "Text provided by API.Bible", url: "https://api.bible" });
  const n95 = catalog.knownApiBible("b8ee27bcd1cae43a-01");
  assert.ok(!n95.notice.includes("2020"), "Lockman: only the years of the edition quoted");
  // A text we know nothing about shows the copyright API.Bible sends with each chapter.
  const other = licensed.apiBibleTranslation({ id: "zzz", abbreviation: "XYZ", name: "Some Bible" });
  assert.equal(other.preferChapterCopyright, true);
});

test("FUMS: one GET per display, with a device id and a session id and no personal data", async () => {
  const f = fakeFetch(() => ({ text: "" }));
  await licensed.reportShown("TOKEN-123", f);
  const u = new URL(f.calls[0].url);
  assert.equal(u.origin + u.pathname, "https://fums.api.bible/f3");
  assert.deepEqual(u.searchParams.getAll("t"), ["TOKEN-123"]);
  assert.ok(u.searchParams.get("dId") && u.searchParams.get("sId"));
  assert.equal(u.searchParams.get("uId"), null);
  const dId = u.searchParams.get("dId");
  await licensed.reportShown("TOKEN-456", f);
  assert.equal(new URL(f.calls[1].url).searchParams.get("dId"), dId, "the device id is stable");
  await licensed.reportShown(undefined, f);
  assert.equal(f.calls.length, 2, "nothing to report, no request");
  assert.equal(fums.fumsUrl(["a", "b"], { device: "d", session: "s" }), "https://fums.api.bible/f3?t=a&t=b&dId=d&sId=s");
});

/* ------------------------------ the layer as a whole ----------------------------- */

test("getLicensedChapter: no key, no request; with a key it fetches once, then reads the cache", async () => {
  const store = cache.memoryCacheStore();
  const f = fakeFetch(() => ({ json: { passages: [ESV_HTML] } }));
  const none = await licensed.getLicensedChapter(licensed.ESV_TRANSLATION, "JHN", 3, { fetch: f, store, keys: { esv: "", nlt: "", apiBible: "" } });
  assert.equal(none.failure, "no-key");
  assert.equal(f.calls.length, 0);

  const keys = { esv: "k", nlt: "", apiBible: "" };
  const a = await licensed.getLicensedChapter(licensed.ESV_TRANSLATION, "JHN", 3, { fetch: f, store, keys, bookVerses: 879 });
  const b = await licensed.getLicensedChapter(licensed.ESV_TRANSLATION, "JHN", 3, { fetch: f, store, keys, bookVerses: 879 });
  assert.equal(f.calls.length, 1, "second read comes from the cache");
  assert.deepEqual(b.chapter, a.chapter);
  assert.deepEqual([...store.map.keys()], ["lic:ESV:JHN.3"]);
  assert.equal(store.map.get("lic:ESV:JHN.3").verses, 3);
});

test("getLicensedChapter: an API.Bible chapter keeps its FUMS token, so a cached display is reported too", async () => {
  const store = cache.memoryCacheStore();
  const f = fakeFetch(() => ({ json: APIBIBLE_JSON }));
  const nasb = licensed.apiBibleTranslation({ id: "a761ca71e0b3ddcf-01", abbreviation: "NASB", name: "NASB 2020" });
  const keys = { esv: "", nlt: "", apiBible: "k" };
  await licensed.getLicensedChapter(nasb, "JHN", 3, { fetch: f, store, keys, bookVerses: 879 });
  const again = await licensed.getLicensedChapter(nasb, "JHN", 3, { fetch: f, store, keys, bookVerses: 879 });
  assert.equal(f.calls.length, 1);
  assert.equal(again.fumsToken, "TOKEN-123");
  assert.equal(again.chapter.copyright, APIBIBLE_JSON.data.copyright.replace(/\s+/g, " ").trim());
});

test("getLicensedChapter: a 401 is 'bad-key' and nothing is cached", async () => {
  const store = cache.memoryCacheStore();
  const f = fakeFetch(() => ({ status: 401, json: {} }));
  const r = await licensed.getLicensedChapter(licensed.NLT_TRANSLATION, "PSA", 23, { fetch: f, store, keys: { esv: "", nlt: "bad", apiBible: "" } });
  assert.equal(r.failure, "bad-key");
  assert.equal(store.map.size, 0);
});

/* ------------------------------- picker and quoting ------------------------------ */

test("the picker offers licensed texts only once their key is saved", () => {
  const ids = (s) => licensed.licensedTranslations(s).map((x) => x.id);
  assert.deepEqual(ids({ bibleKeys: { esv: "", nlt: "", apiBible: "" }, apiBibleBibles: [] }), []);
  assert.deepEqual(
    ids({
      bibleKeys: { esv: "k", nlt: "k", apiBible: "k" },
      apiBibleBibles: [{ id: "a761ca71e0b3ddcf-01", abbreviation: "NASB", name: "New American Standard Bible 2020" }],
    }),
    ["ESV", "NLT", "apibible:a761ca71e0b3ddcf-01"],
  );
  // The chosen texts need the key too.
  assert.deepEqual(ids({ bibleKeys: { esv: "", nlt: "", apiBible: "" }, apiBibleBibles: [{ id: "x", abbreviation: "X", name: "X" }] }), []);
});

test("free translations: every one has a notice, and the NET is linked as its licence asks", () => {
  for (const tr of bible.FREE_TRANSLATIONS) assert.ok(tr.notice, tr.id);
  const net = bible.FREE_TRANSLATIONS.find((x) => x.id === "eng_net");
  assert.equal(net.noticeUrl, "http://netbible.org");
  assert.match(net.copyNotice, /Quotations designated \(NET\) are from the NET Bible®/);
  assert.equal(new Set(bible.FREE_TRANSLATIONS.map((x) => x.id)).size, bible.FREE_TRANSLATIONS.length, "ids are unique");
  assert.equal(bible.translationById("ESV")?.source, "esv", "known even without a key, so the reader can name it");
  assert.equal(bible.translationById("apibible:a761ca71e0b3ddcf-01")?.short, "NASB");
});

test("the reader explains a missing key rather than calling it 'offline'", async () => {
  useUI.setState({ bibleKeys: { esv: "", nlt: "", apiBible: "" }, apiBibleBibles: [] });
  const r = await bible.loadChapterFor("ESV", "JHN", 3);
  assert.equal(r.chapter, null);
  assert.equal(r.failure, "no-key");
  const r2 = await bible.loadChapterFor("apibible:unknown-01", "JHN", 3);
  assert.equal(r2.failure, "no-key");
});

test("copying verses adds the licence's attribution", () => {
  const one = citation("JHN", 3, [{ n: 16, text: "For God so loved the world…" }], "ESV");
  assert.equal(one, "For God so loved the world… — John 3:16 (ESV)");
  const nasb = licensed.apiBibleTranslation({ id: "a761ca71e0b3ddcf-01", abbreviation: "NASB", name: "NASB 2020" });
  const two = citation("JHN", 3, [{ n: 16, text: "A" }, { n: 17, text: "B" }], nasb.short, nasb.copyNotice);
  assert.equal(two, `A\nB\n — John 3:16-17 (NASB)\n\n${nasb.notice}`);
});

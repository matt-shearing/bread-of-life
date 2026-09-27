/**
 * Tests for backup/restore (src/lib/backup.ts) and the Markdown export
 * (src/lib/markdownExport.ts), against the REAL Dexie schema and sync hooks running on
 * fake-indexeddb.
 *
 * Run: pnpm test:backup   (or: node scripts/test-backup.mjs)
 *
 * Needs Node 23.6+ (imports the TypeScript sources directly). A module hook maps the
 * `@/` alias and extensionless imports the way Vite does, stubs the Tauri HTTP plugin,
 * and blanks `import.meta.env` (Vite-only) in the sources.
 *
 * Runs in Perth (UTC+8) so a UTC date in a file name would show up as the wrong day.
 */
process.env.TZ = "Australia/Perth";

import "fake-indexeddb/auto";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const STUBS = {
  "@tauri-apps/plugin-http": "data:text/javascript," + encodeURIComponent("export const fetch = globalThis.fetch;"),
};

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: STUBS[specifier], shortCircuit: true };
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(SRC + spec.slice(2)).href;
    const fromSrc = context.parentURL?.includes("/src/");
    if ((spec.startsWith("file:") || (fromSrc && spec.startsWith("."))) && !/\.[cm]?[jt]sx?$|\.json$/.test(spec)) {
      const base = spec.startsWith("file:") ? fileURLToPath(spec) : fileURLToPath(new URL(spec, context.parentURL));
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true, format: "module-typescript" };
      }
    }
    return next(spec, context);
  },
  load(url, context, next) {
    const r = next(url, context);
    if (url.includes("/src/") && /\.ts$/.test(url) && r.source) {
      const src = String(r.source).replaceAll("import.meta.env", "({})");
      return { ...r, source: src };
    }
    return r;
  },
});

const { db } = await import("../src/db/index.ts");
const { installSyncHooks, SYNCED_TABLES, SYNCED_KEY_PATH } = await import("../src/db/sync.ts");
const backup = await import("../src/lib/backup.ts");
const md = await import("../src/lib/markdownExport.ts");
const { unzipSync, strFromU8 } = await import("fflate");

installSyncHooks(); // as the app does at startup: rows get updatedAt, edits hit the outbox

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const T0 = new Date(2025, 0, 10, 9, 30).getTime();

/** One or more rows in every user table, plus a cache and a device-only setting. */
async function seed() {
  await db.highlights.bulkPut([
    { id: "John.3.16", osis: "John.3.16", bbcccvvv: 43003016, color: "amber", createdAt: T0 },
    { id: "Ps.23.1", osis: "Ps.23.1", bbcccvvv: 19023001, color: "sky", createdAt: T0 },
  ]);
  await db.notes.put({ id: "John.3.16", osis: "John.3.16", bbcccvvv: 43003016, body: "For God so *loved*", createdAt: T0, updatedAt: T0 });
  await db.prayers.bulkPut([
    {
      id: "p1", title: "Mum's surgery", body: "<p>Steady hands for the surgeons.</p>", category: "family", status: "answered",
      prayedCount: 14, lastPrayedAt: T0 + 5e8, createdAt: T0, answeredAt: T0 + 6e8, answerNote: "She came home on Friday.",
      linkedOsis: ["Ps.23.1"], linkedJournalIds: ["j1"], remind: false,
    },
    {
      id: "p2", title: "Work", body: "", category: "personal", status: "active", prayedCount: 0, lastPrayedAt: null,
      createdAt: T0 + 1e8, answeredAt: null, answerNote: null, linkedOsis: [], remind: true,
    },
  ]);
  await db.journal.put({
    id: "j1", title: "Waiting room", body: "<h2>Tuesday</h2><p>Sat with <strong>Psalm 23</strong>.</p>", tags: ["family"],
    linkedOsis: ["Ps.23.1"], linkedPrayerIds: ["p1"], source: "manual", createdAt: T0, updatedAt: T0,
  });
  await db.progress.put({ chapterOsis: "John.3", ho: "JHN", chapter: 3, lastVerse: 16, at: T0 });
  await db.settings.bulkPut([
    { key: "ui.activePlanId", value: "mcheyne" },
    { key: "prayers.customCategories", value: ["church"] },
    { key: "misslerLibraryPath", value: "/home/matt/missler" },
  ]);
  await db.plans.put({ planId: "mcheyne", startedAt: T0, completedDays: [0, 1], chapterProgress: { 2: [0] }, completedAt: { 0: T0, 1: T0 + 864e5 } });
  await db.devotions.put({ id: "01-10:m", completedAt: T0 });
  await db.customPlans.put({ id: "c1", name: "Gospels", description: "", days: [[{ ho: "MRK", chapter: 1 }]], createdAt: T0 });
  await db.memory.put({
    id: "John.3.16", osis: "John.3.16", bbcccvvv: 43003016, ho: "JHN", chapter: 3, verse: 16, reference: "John 3:16",
    text: "For God so loved the world…", translation: "BSB", source: "reader", easeFactor: 2.5, intervalDays: 1,
    repetitions: 1, lapses: 0, dueAt: T0 + 864e5, lastReviewedAt: T0, createdAt: T0,
  });
  await db.commentary.put({ key: "mh:John.3", html: "<p>cache</p>", fetchedAt: T0 });
  await tick();
}

async function snapshot() {
  const out = {};
  for (const t of SYNCED_TABLES) out[t] = await db.table(t).toArray();
  return out;
}
const byKey = (t) => (a, b) => String(a[SYNCED_KEY_PATH[t]]).localeCompare(String(b[SYNCED_KEY_PATH[t]]));

async function wipe() {
  await Promise.all([...SYNCED_TABLES, "commentary"].map((t) => db.table(t).clear()));
  await tick(); // clear() fires the deleting hooks, which queue tombstones a tick later
  await db.outbox.clear();
}

test("backup → wipe → restore gives back every table exactly, and queues it all for upload", async () => {
  await wipe();
  await seed();
  const before = await snapshot();

  const file = await backup.createBackup("9.9.9", new Date(2026, 8, 27, 7, 0).getTime());
  assert.equal(file.app, "bread-of-life");
  assert.equal(file.format, 1);
  assert.equal(file.appVersion, "9.9.9");
  assert.equal(file.dbVersion, db.verno);
  assert.deepEqual(Object.keys(file.tables).sort(), [...SYNCED_TABLES].sort());
  assert.ok(!("commentary" in file.tables) && !("outbox" in file.tables) && !("syncState" in file.tables));
  assert.ok(!file.tables.settings.some((s) => s.key === "misslerLibraryPath"), "device-only setting left out");
  for (const t of SYNCED_TABLES) assert.ok(file.tables[t].length > 0, `${t} is in the backup`);

  const text = backup.serializeBackup(file);
  await wipe();
  assert.equal(await db.prayers.count(), 0);

  const parsed = backup.parseBackup(text);
  const plan = await backup.previewRestore(parsed);
  assert.equal(plan.totals.add, plan.totals.inFile);
  assert.equal(plan.totals.update + plan.totals.keep + plan.totals.same, 0);
  assert.match(backup.describeContents(plan), /^2 prayers, 1 journal entry, 1 note, 2 highlights, 1 memory verse/);

  const r = await backup.applyRestore(parsed);
  assert.equal(r.added, plan.totals.inFile);

  const after = await snapshot();
  for (const t of SYNCED_TABLES) {
    const want = before[t].filter((row) => !(t === "settings" && row.key === "misslerLibraryPath")).sort(byKey(t));
    assert.deepEqual(after[t].sort(byKey(t)), want, `${t} round-trips exactly (updatedAt kept, not restamped)`);
  }

  await tick();
  const outbox = await db.outbox.toArray();
  const expected = SYNCED_TABLES.flatMap((t) => after[t].map((row) => `${t}:${row[SYNCED_KEY_PATH[t]]}`)).sort();
  assert.deepEqual(outbox.map((o) => o.key).sort(), expected, "every restored row is queued for upload");
  assert.ok(outbox.every((o) => o.op === "upsert"));
});

test("restoring the same file twice adds nothing the second time", async () => {
  await wipe();
  await seed();
  const text = backup.serializeBackup(await backup.createBackup("9.9.9"));
  const counts = async () => Promise.all(SYNCED_TABLES.map((t) => db.table(t).count()));
  const c0 = await counts();

  await db.outbox.clear();
  const first = await backup.applyRestore(backup.parseBackup(text));
  assert.equal(first.added + first.updated, 0, "already identical to what is on the device");
  const plan2 = await backup.previewRestore(backup.parseBackup(text));
  assert.equal(plan2.totals.same, plan2.totals.inFile);
  assert.deepEqual(backup.describeEffect(plan2), [
    "Everything in this backup is already on this device. Restoring would change nothing.",
  ]);
  await backup.applyRestore(backup.parseBackup(text));
  assert.deepEqual(await counts(), c0, "no duplicates");
  await tick();
  assert.equal(await db.outbox.count(), 0, "unchanged rows are not re-uploaded");

  // And onto an empty device twice.
  await wipe();
  await backup.applyRestore(backup.parseBackup(text));
  await backup.applyRestore(backup.parseBackup(text));
  const c2 = await counts();
  assert.deepEqual(c2, c0.map((n, i) => (SYNCED_TABLES[i] === "settings" ? n - 1 : n)));
});

test("a newer row on this device is kept; a newer row in the backup wins", async () => {
  await wipe();
  await seed();
  const file = await backup.createBackup("9.9.9");

  // Edited on this device after the backup was made (hooks stamp updatedAt = now).
  await tick(5);
  await db.prayers.update("p2", { title: "Work — the new role" });
  await tick(); // let that edit's own outbox entry land before we clear the outbox below
  // The backup holds a newer copy of the journal entry than the device.
  const j = file.tables.journal.find((r) => r.id === "j1");
  j.title = "Waiting room (edited on the laptop)";
  j.updatedAt = Date.now() + 60_000;
  // And something the device has never seen.
  file.tables.prayers.push({ ...file.tables.prayers[1], id: "p3", title: "Brand new" });

  const parsed = backup.parseBackup(backup.serializeBackup(file));
  const plan = await backup.previewRestore(parsed);
  assert.deepEqual(
    { add: plan.tables.prayers.add, keep: plan.tables.prayers.keep, update: plan.tables.journal.update },
    { add: 1, keep: 1, update: 1 },
  );
  assert.ok(backup.describeEffect(plan).includes("1 is newer on this device and will be kept."));

  await db.outbox.clear();
  const r = await backup.applyRestore(parsed);
  assert.equal(r.kept, 1);
  assert.equal((await db.prayers.get("p2")).title, "Work — the new role", "local edit survives");
  assert.equal((await db.journal.get("j1")).title, "Waiting room (edited on the laptop)");
  assert.equal((await db.journal.get("j1")).updatedAt, j.updatedAt, "restored row keeps its own updatedAt");
  assert.equal((await db.prayers.get("p3")).title, "Brand new");
  await tick();
  assert.deepEqual((await db.outbox.toArray()).map((o) => o.key).sort(), ["journal:j1", "prayers:p3"]);
});

test("device-only settings are never imported onto another device", async () => {
  await wipe();
  await seed();
  await db.settings.delete("misslerLibraryPath");
  const file = await backup.createBackup("9.9.9");
  file.tables.settings.push({ key: "misslerLibraryPath", value: "/some/other/disk", updatedAt: Date.now() + 1e6 });
  const parsed = backup.parseBackup(JSON.stringify(file));
  const plan = await backup.previewRestore(parsed);
  assert.equal(plan.skippedDeviceSettings, 1);
  await backup.applyRestore(parsed);
  assert.equal(await db.settings.get("misslerLibraryPath"), undefined);
});

test("files that are not backups are refused with a plain message", () => {
  const { parseBackup, BackupError } = backup;
  assert.throws(() => parseBackup("not json"), BackupError);
  assert.throws(() => parseBackup(JSON.stringify({ app: "something-else", format: 1, tables: {} })), /isn’t a Bread of Life backup/);
  assert.throws(() => parseBackup(JSON.stringify({ app: "bread-of-life", format: 2, tables: {} })), /newer version/);
  assert.throws(() => parseBackup(JSON.stringify({ app: "bread-of-life", format: 1 })), /no data/);
  const p = parseBackup(JSON.stringify({ app: "bread-of-life", format: 1, tables: { prayers: [{ id: "" }, { title: "x" }, { id: "ok" }], futureThing: [] } }));
  assert.equal(p.invalidRows, 2);
  assert.deepEqual(p.unknownTables, ["futureThing"]);
  assert.equal(p.backup.tables.prayers.length, 1);
});

test("backup file name uses the LOCAL date", () => {
  // 07:00 on 27 Sep in Perth is still 26 Sep in UTC.
  assert.equal(backup.backupFileName(new Date(2026, 8, 27, 7, 0).getTime()), "bread-of-life-backup-2026-09-27.json");
  assert.equal(md.markdownExportFileName(new Date(2026, 8, 27, 7, 0).getTime()), "bread-of-life-markdown-2026-09-27.zip");
});

/* -------------------------------- Markdown -------------------------------- */

test("Tiptap HTML converts to clean Markdown", () => {
  const html =
    "<h2>Morning</h2><p>I read <strong>Psalm 23</strong> and <em>rested</em>. See <a href=\"https://example.com/a b\">this</a>.</p>" +
    "<ul><li><p>Grace</p></li><li><p>Mercy</p><ul><li><p>new every morning</p></li></ul></li></ul>" +
    "<ol><li><p>Ask</p></li><li><p>Seek</p></li></ol>" +
    "<blockquote><p>The LORD is my shepherd;</p><p>I shall not want.</p></blockquote>" +
    "<p>Line one<br>line two &amp; <s>three</s> <code>x*y</code></p><p></p><hr><p><strong><em>both</em></strong> and <strong>bold </strong>word</p>" +
    "<pre><code class=\"language-js\">let a = 1;</code></pre><h3>2 * 2</h3><p># not a heading</p>";
  assert.equal(
    md.htmlToMarkdown(html),
    [
      "## Morning",
      "I read **Psalm 23** and *rested*. See [this](https://example.com/a%20b).",
      "- Grace\n- Mercy\n  - new every morning",
      "1. Ask\n2. Seek",
      "> The LORD is my shepherd;\n>\n> I shall not want.",
      "Line one\\\nline two & ~~three~~ `x*y`",
      "---",
      "***both*** and **bold** word",
      "```js\nlet a = 1;\n```",
      "### 2 \\* 2",
      "\\# not a heading",
    ].join("\n\n"),
  );
  assert.equal(md.htmlToMarkdown("Plain words\nwith a break\n\nNew para"), "Plain words\\\nwith a break\n\nNew para");
  assert.equal(md.htmlToMarkdown(""), "");
  assert.equal(md.htmlToMarkdown("<p>caf&eacute; &#233; &#x1F64F;</p>"), "caf&eacute; é 🙏");
});

test("Markdown export: one file per journal entry with front matter, Prayers.md, Notes.md, zipped", async () => {
  await wipe();
  await seed();
  await db.journal.put({ id: "j2", title: "Waiting room", body: "Plain text entry", tags: [], linkedOsis: [], source: null, createdAt: T0 + 1000, updatedAt: T0 + 1000 });
  const { bytes, files } = await md.createMarkdownZip();
  const unzipped = unzipSync(bytes);
  const names = Object.keys(unzipped).sort();
  assert.equal(files, names.length);
  assert.deepEqual(names, [
    "Bread of Life/Journal/2025-01-10 Waiting room (2).md",
    "Bread of Life/Journal/2025-01-10 Waiting room.md",
    "Bread of Life/Notes.md",
    "Bread of Life/Prayers.md",
  ]);
  const entry = strFromU8(unzipped["Bread of Life/Journal/2025-01-10 Waiting room.md"]);
  assert.equal(
    entry,
    [
      "---",
      'title: "Waiting room"',
      "created: 2025-01-10T09:30",
      `updated: ${entry.match(/updated: (\S+)/)[1]}`,
      "tags:\n  - \"family\"",
      "verses:\n  - \"Psalms 23:1\"",
      "prayers:\n  - \"Mum's surgery\"",
      'source: "manual"',
      "---",
      "",
      "# Waiting room",
      "",
      "## Tuesday",
      "",
      "Sat with **Psalm 23**.",
      "",
    ].join("\n"),
  );
  const prayers = strFromU8(unzipped["Bread of Life/Prayers.md"]);
  assert.match(prayers, /## Answered\n\n### Mum's surgery\n/);
  assert.match(prayers, /> \*\*Answered 2025-01-17\*\*\n>\n> She came home on Friday\./);
  assert.match(prayers, /Journal: \[\[Journal\/2025-01-10 Waiting room\|2025-01-10 Waiting room\]\]/);
  assert.match(prayers, /## Still praying\n\n### Work\n/);
  assert.ok(prayers.indexOf("## Answered") < prayers.indexOf("## Still praying"));
  const notes = strFromU8(unzipped["Bread of Life/Notes.md"]);
  assert.match(notes, /^# Notes and highlights\n\n1 note · 2 highlights, in Bible order/);
  assert.ok(notes.indexOf("## Psalms") < notes.indexOf("## John"), "Bible order");
  assert.match(notes, /### John 3:16\n\n\*Highlighted amber\*\n\nFor God so \\\*loved\\\*/);
});

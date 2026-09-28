/**
 * Tests for backup/restore (src/lib/backup.ts) and the Markdown export
 * (src/lib/markdownExport.ts): the REAL Dexie schema and sync middleware on
 * fake-indexeddb, as independent devices (scripts/lib/sync-devices.mjs), and a real
 * sync server (v0.4.0 and current) for the "old backup must not beat newer edits" cases.
 *
 * Run: pnpm test:backup   (or: node --test-reporter=spec scripts/test-backup.mjs)
 * Needs Node 23.6+ (imports the TypeScript sources directly).
 *
 * Runs in Perth (UTC+8) so a UTC date in a file name would show up as the wrong day.
 */
process.env.TZ = "Australia/Perth";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { device } from "./lib/sync-devices.mjs";
import { startServer, serverRows } from "./lib/sync-server.mjs";
import { unzipSync, strFromU8 } from "fflate";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const T0 = new Date(2025, 0, 10, 9, 30).getTime();

/** A fresh device with the backup and Markdown modules loaded as that device. */
async function fresh(name) {
  const d = await device(name);
  d.backup = await d.load("lib/backup.ts");
  d.md = await d.load("lib/markdownExport.ts");
  d.schema = await d.load("db/syncSchema.ts");
  return d;
}
const servers = [];
after(async () => {
  for (const s of servers) await s.stop();
});

/** One or more rows in every user table, plus a cache and a device-only setting. */
async function seed({ db }) {
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
  if (db.readingLog) {
    await db.readingLog.put({ id: "2026-01-10:John.3", dayKey: "2026-01-10", osis: "John.3", ho: "JHN", chapter: 3, source: "reader", at: T0 });
  }
  await db.settings.bulkPut([
    { key: "ui.activePlanId", value: "mcheyne" },
    { key: "prayers.customCategories", value: ["church"] },
    { key: "misslerLibraryPath", value: "/home/matt/missler" },
    { key: "some.futureDeviceThing", value: 1 },
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

/** The tables a backup holds: every synced one except the API keys, which never go in a file. */
const backupTables = (schema) => schema.SYNCED_TABLES.filter((t) => !schema.ALWAYS_ENCRYPTED_TABLES.has(t));

async function snapshot({ db, schema }) {
  const out = {};
  for (const t of backupTables(schema)) out[t] = await db.table(t).toArray();
  return out;
}
const DEVICE_ONLY = new Set(["misslerLibraryPath", "some.futureDeviceThing"]);

test("backup → restore on an empty device gives back every table exactly, and queues it all for upload", async () => {
  const A = await fresh("A");
  await seed(A);
  const before = await snapshot(A);

  const file = await A.backup.createBackup("9.9.9", new Date(2026, 8, 27, 7, 0).getTime());
  assert.equal(file.app, "bread-of-life");
  assert.equal(file.format, 1);
  assert.equal(file.appVersion, "9.9.9");
  assert.equal(file.exportedAt, "2026-09-26T23:00:00.000Z");
  assert.equal(file.dbVersion, A.db.verno);
  assert.deepEqual(Object.keys(file.tables).sort(), [...backupTables(A.schema)].sort());
  assert.ok(!("commentary" in file.tables) && !("outbox" in file.tables) && !("syncState" in file.tables));
  assert.ok(!("apiKeys" in file.tables), "API keys never go in a backup");
  assert.deepEqual(file.tables.settings.map((s) => s.key).sort(), ["prayers.customCategories", "ui.activePlanId"], "device-only settings left out");
  for (const t of backupTables(A.schema)) assert.ok(file.tables[t].length > 0, `${t} is in the backup`);

  const B = await fresh("B");
  const parsed = B.backup.parseBackup(A.backup.serializeBackup(file));
  const plan = await B.backup.previewRestore(parsed);
  assert.equal(plan.totals.add, plan.totals.inFile);
  assert.equal(plan.totals.update + plan.totals.keep + plan.totals.same, 0);
  assert.match(B.backup.describeContents(plan), /^2 prayers, 1 journal entry, 1 note, 2 highlights, 1 memory verse/);
  assert.match(B.backup.describeContents(plan), /1 chapter bookmark, 1 reading-history entry, 2 settings$/, "reading history is listed");

  const r = await B.backup.applyRestore(parsed);
  assert.equal(r.added, plan.totals.inFile);

  const got = await snapshot(B);
  for (const t of backupTables(A.schema)) {
    const key = A.schema.KEY_PATH[t];
    const sort = (rows) => [...rows].sort((x, y) => String(x[key]).localeCompare(String(y[key])));
    const want = before[t].filter((row) => !(t === "settings" && DEVICE_ONLY.has(row.key)));
    assert.deepEqual(sort(got[t]), sort(want), `${t} round-trips exactly (updatedAt kept, not restamped)`);
  }

  const outbox = await B.db.outbox.toArray();
  const expected = backupTables(A.schema).flatMap((t) => got[t].map((row) => `${t}:${row[A.schema.KEY_PATH[t]]}`)).sort();
  assert.deepEqual(outbox.map((o) => o.key).sort(), expected, "every restored row is queued for upload");
  assert.ok(outbox.every((o) => o.op === "upsert"));
});

test("restoring the same file twice adds nothing the second time", async () => {
  const A = await fresh("A");
  await seed(A);
  const text = A.backup.serializeBackup(await A.backup.createBackup("9.9.9"));
  const counts = async (d) => Promise.all(backupTables(d.schema).map((t) => d.db.table(t).count()));
  const c0 = await counts(A);

  await A.db.outbox.clear();
  const first = await A.backup.applyRestore(A.backup.parseBackup(text));
  assert.equal(first.added + first.updated, 0, "already identical to what is on the device");
  const plan2 = await A.backup.previewRestore(A.backup.parseBackup(text));
  assert.equal(plan2.totals.same, plan2.totals.inFile);
  assert.deepEqual(A.backup.describeEffect(plan2), [
    "Everything in this backup is already on this device. Restoring would change nothing.",
  ]);
  assert.deepEqual(await counts(A), c0, "no duplicates");
  assert.equal(await A.db.outbox.count(), 0, "unchanged rows are not re-uploaded");

  // And onto an empty device twice.
  const B = await fresh("B");
  await B.backup.applyRestore(B.backup.parseBackup(text));
  const c1 = await counts(B);
  const second = await B.backup.applyRestore(B.backup.parseBackup(text));
  assert.equal(second.added + second.updated, 0);
  assert.deepEqual(await counts(B), c1);
  assert.deepEqual(c1, c0.map((n, i) => (backupTables(A.schema)[i] === "settings" ? n - DEVICE_ONLY.size : n)));
});

test("a newer row on this device is kept; a newer row in the backup wins", async () => {
  const A = await fresh("A");
  await seed(A);
  const file = await A.backup.createBackup("9.9.9");

  // Edited on this device after the backup was made (the middleware stamps it now).
  await tick(5);
  await A.db.prayers.update("p2", { title: "Work — the new role" });
  // The backup holds a newer copy of the journal entry than the device.
  const j = file.tables.journal.find((r) => r.id === "j1");
  j.title = "Waiting room (edited on the laptop)";
  j.updatedAt = Date.now() + 60_000;
  // And something the device has never seen.
  file.tables.prayers.push({ ...file.tables.prayers[1], id: "p3", title: "Brand new" });

  const parsed = A.backup.parseBackup(A.backup.serializeBackup(file));
  const plan = await A.backup.previewRestore(parsed);
  assert.deepEqual(
    { add: plan.tables.prayers.add, keep: plan.tables.prayers.keep, update: plan.tables.journal.update },
    { add: 1, keep: 1, update: 1 },
  );
  assert.ok(A.backup.describeEffect(plan).includes("1 is newer on this device and will be kept."));

  await A.db.outbox.clear();
  const r = await A.backup.applyRestore(parsed);
  assert.equal(r.kept, 1);
  assert.equal((await A.db.prayers.get("p2")).title, "Work — the new role", "local edit survives");
  assert.equal((await A.db.journal.get("j1")).title, "Waiting room (edited on the laptop)");
  assert.equal((await A.db.journal.get("j1")).updatedAt, j.updatedAt, "restored row keeps its own updatedAt");
  assert.equal((await A.db.prayers.get("p3")).title, "Brand new");
  assert.deepEqual((await A.db.outbox.toArray()).map((o) => o.key).sort(), ["journal:j1", "prayers:p3"]);
});

test("reading-plan progress merges day by day instead of one copy replacing the other", async () => {
  const A = await fresh("A");
  await A.db.plans.put({ planId: "p", startedAt: T0, completedDays: [0, 1], chapterProgress: {}, completedAt: { 0: T0, 1: T0 } });
  const file = await A.backup.createBackup("9.9.9");
  // Since the backup: day 2 finished here. The backup, meanwhile, knows day 5 (made up).
  await A.db.plans.put({ ...(await A.db.plans.get("p")), completedDays: [0, 1, 2], completedAt: { 0: T0, 1: T0, 2: T0 + 3 } });
  file.tables.plans[0].completedDays.push(5);
  file.tables.plans[0].completedAt[5] = T0 + 5;
  await A.backup.applyRestore(A.backup.parseBackup(JSON.stringify(file)));
  assert.deepEqual((await A.db.plans.get("p")).completedDays, [0, 1, 2, 5]);
});

test("device-only settings are never backed up or imported onto another device", async () => {
  const A = await fresh("A");
  await seed(A);
  const file = await A.backup.createBackup("9.9.9");
  assert.ok(!file.tables.settings.some((s) => DEVICE_ONLY.has(s.key)));
  const B = await fresh("B");
  await B.db.settings.put({ key: "misslerLibraryPath", value: "/storage/emulated/0/Missler" });
  file.tables.settings.push({ key: "misslerLibraryPath", value: "/some/other/disk", updatedAt: Date.now() + 1e6 });
  file.tables.settings.push({ key: "anything.else", value: 1, updatedAt: 1 });
  const parsed = B.backup.parseBackup(JSON.stringify(file));
  const plan = await B.backup.previewRestore(parsed);
  assert.equal(plan.skippedDeviceSettings, 2);
  await B.backup.applyRestore(parsed);
  assert.equal((await B.db.settings.get("misslerLibraryPath")).value, "/storage/emulated/0/Missler");
  assert.equal(await B.db.settings.get("anything.else"), undefined);
});

for (const flavor of ["v0.4.0", "current"]) {
  test(`[${flavor} server] an old backup restored on a signed-in device doesn't beat newer edits on the account`, async () => {
    const srv = await startServer(flavor);
    servers.push(srv);
    const A = await fresh("A");
    A.sync.setAutoSync(false);
    assert.ok((await A.sync.signup("selfhost", srv.url, `b-${flavor}@x.org`, "password123")).ok);
    await A.db.journal.put({ id: "j1", title: "Waiting room", body: "<p>v1</p>", tags: [], linkedOsis: [], source: "manual", createdAt: T0, updatedAt: T0 });
    await A.sync.syncNow();
    const file = await A.backup.createBackup("9.9.9"); // holds j1 = v1
    file.tables.prayers = [{ id: "px", title: "Only in the backup", body: "", category: "personal", status: "active", prayedCount: 0, lastPrayedAt: null, createdAt: T0, answeredAt: null, answerNote: null, linkedOsis: [], updatedAt: T0 }];
    await tick(5);
    await A.db.journal.update("j1", { body: "<p>v2, written after the backup</p>" });
    await A.sync.syncNow();

    // A second device, signed in to the same account, restores the old file.
    const B = await fresh("B");
    B.sync.setAutoSync(false);
    const login = await B.sync.login("selfhost", srv.url, `b-${flavor}@x.org`, "password123");
    assert.ok(login.ok);
    await B.sync.syncNow();
    const r = await B.backup.applyRestore(B.backup.parseBackup(JSON.stringify(file)));
    assert.equal(r.kept, 1, "B already has the newer j1 from the pull");
    await B.sync.syncNow();
    await A.sync.syncNow();

    const rows = await serverRows(srv);
    const j1 = rows.filter((x) => x.tbl === "journal" && x.id === "j1").at(-1);
    assert.match(JSON.stringify(j1.data), /v2, written after the backup/, "server keeps the newer edit");
    assert.ok(rows.some((x) => x.tbl === "prayers" && x.id === "px"), "the backup-only prayer uploaded");
    assert.equal((await A.db.prayers.get("px"))?.title, "Only in the backup", "and reached the other device");
    assert.match((await B.db.journal.get("j1")).body, /v2/);
  });

  test(`[${flavor} server] restoring a backup brings back an item deleted on the account, and it stays back`, async () => {
    const srv = await startServer(flavor);
    servers.push(srv);
    const email = `d-${flavor}@x.org`;
    const A = await fresh("A");
    A.sync.setAutoSync(false);
    assert.ok((await A.sync.signup("selfhost", srv.url, email, "password123")).ok);
    await A.db.journal.put({ id: "j1", title: "Waiting room", body: "<p>keep me</p>", tags: [], linkedOsis: [], source: "manual", createdAt: T0, updatedAt: T0 });
    await A.sync.syncNow();
    const text = A.backup.serializeBackup(await A.backup.createBackup("9.9.9"));
    await tick(5);
    await A.db.journal.delete("j1");
    await A.sync.syncNow();
    assert.ok((await serverRows(srv)).find((x) => x.tbl === "journal" && x.id === "j1")?.deleted, "deleted on the server");

    const parsed = A.backup.parseBackup(text);
    const plan = await A.backup.previewRestore(parsed);
    assert.equal(plan.tables.journal.add, 1);
    const r = await A.backup.applyRestore(parsed);
    assert.equal(r.added, 1);
    await A.sync.syncNow();
    await A.sync.syncNow();

    assert.match((await A.db.journal.get("j1"))?.body ?? "gone", /keep me/, "still here after syncing");
    const row = (await serverRows(srv)).filter((x) => x.tbl === "journal" && x.id === "j1").at(-1);
    assert.ok(row && !row.deleted, "the server holds it again");
    const C = await fresh("C");
    C.sync.setAutoSync(false);
    assert.ok((await C.sync.login("selfhost", srv.url, email, "password123")).ok);
    await C.sync.syncNow();
    assert.match((await C.db.journal.get("j1"))?.body ?? "gone", /keep me/, "a fresh signed-in device gets it");
  });

  test(`[${flavor} server] restoring an old backup on a device that missed newer edits leaves the server's copy winning`, async () => {
    const srv = await startServer(flavor);
    servers.push(srv);
    const A = await fresh("A");
    A.sync.setAutoSync(false);
    assert.ok((await A.sync.signup("selfhost", srv.url, `c-${flavor}@x.org`, "password123")).ok);
    await A.db.journal.put({ id: "j1", title: "t", body: "<p>v1</p>", tags: [], linkedOsis: [], source: "manual", createdAt: T0, updatedAt: T0 });
    await A.sync.syncNow();
    const file = await A.backup.createBackup("9.9.9");
    await tick(5);
    await A.db.journal.update("j1", { body: "<p>v2</p>" });
    await A.sync.syncNow();

    // B restores FIRST (so it writes the old v1 locally), then signs in and syncs.
    const B = await fresh("B");
    B.sync.setAutoSync(false);
    await B.backup.applyRestore(B.backup.parseBackup(JSON.stringify(file)));
    assert.equal((await B.db.journal.get("j1")).updatedAt, file.tables.journal[0].updatedAt, "old stamp kept");
    const login = await B.sync.login("selfhost", srv.url, `c-${flavor}@x.org`, "password123");
    assert.ok(login.ok);
    if (login.needsAccountChoice) await B.sync.resolveAccountChoice("upload");
    await B.sync.syncNow();
    await B.sync.syncNow();
    await A.sync.syncNow();
    assert.match((await B.db.journal.get("j1")).body, /v2/, "B ends up with the newer copy");
    assert.match((await A.db.journal.get("j1")).body, /v2/, "A is not rolled back");
  });
}

/* -------------------------------- Markdown -------------------------------- */

const M = await fresh("md");
const md = M.md;

test("files that are not backups are refused with a plain message", () => {
  const { parseBackup, BackupError } = M.backup;
  assert.throws(() => parseBackup("not json"), BackupError);
  assert.throws(() => parseBackup(JSON.stringify({ app: "something-else", format: 1, tables: {} })), /isn’t a Bread of Life backup/);
  assert.throws(() => parseBackup(JSON.stringify({ app: "bread-of-life", format: 2, tables: {} })), /newer version/);
  assert.throws(() => parseBackup(JSON.stringify({ app: "bread-of-life", format: 1 })), /no data/);
  const p = parseBackup(JSON.stringify({ app: "bread-of-life", format: 1, tables: { prayers: [{ id: "" }, { title: "x" }, { id: "ok" }], futureThing: [] } }));
  assert.equal(p.invalidRows, 2);
  assert.deepEqual(p.unknownTables, ["futureThing"]);
  assert.equal(p.backup.tables.prayers.length, 1);
});

test("backup and export file names use the LOCAL date", () => {
  // 07:00 on 27 Sep in Perth is still 26 Sep in UTC.
  assert.equal(M.backup.backupFileName(new Date(2026, 8, 27, 7, 0).getTime()), "bread-of-life-backup-2026-09-27.json");
  assert.equal(md.markdownExportFileName(new Date(2026, 8, 27, 7, 0).getTime()), "bread-of-life-markdown-2026-09-27.zip");
});


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
  const D = await fresh("D");
  await seed(D);
  await D.db.journal.put({ id: "j2", title: "Waiting room", body: "Plain text entry", tags: [], linkedOsis: [], source: null, createdAt: T0 + 1000, updatedAt: T0 + 1000 });
  const { bytes, files } = await D.md.createMarkdownZip();
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

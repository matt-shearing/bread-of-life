/**
 * Reading history tests: the reading log (src/db/readingLog.ts), the streak it feeds
 * (src/lib/streak.ts), its one-off backfill on upgrade, its sync between devices, and the
 * History page / "On this day" helpers (src/lib/readingHistory.ts, src/lib/onThisDay.ts).
 *
 * Run: node scripts/test-reading-history.mjs
 *
 * Runs itself twice, in Perth (UTC+8, no daylight saving: a UTC date is wrong every
 * morning before 8 am) and in New York (to cross daylight-saving changes). Uses the real
 * client code on fake-indexeddb (scripts/lib/sync-devices.mjs) and real sync servers.
 * Needs Node 23.6+.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const ZONES = ["Australia/Perth", "America/New_York"];

if (!process.env.BOL_TEST_TZ) {
  let failed = false;
  for (const tz of ZONES) {
    console.log(`\n=== TZ=${tz}`);
    const r = spawnSync(process.execPath, ["--test-reporter=spec", fileURLToPath(import.meta.url)], {
      stdio: "inherit",
      env: { ...process.env, TZ: tz, BOL_TEST_TZ: tz },
    });
    if (r.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

const TZ = process.env.BOL_TEST_TZ;
const { device } = await import("./lib/sync-devices.mjs");
const { startServer, serverRows } = await import("./lib/sync-server.mjs");
const { readingStreak, readingDayKeys, longestStreak } = await import("../src/lib/streak.ts");
const { localDayKey } = await import("../src/lib/day.ts");
const { heatmapWeeks, chaptersPerDay, chaptersInPeriod, bookProgress, intensity, recentDays } = await import(
  "../src/lib/readingHistory.ts"
);
const { dayWindows, memoriesOnThisDay, yearsAgoLabel } = await import("../src/lib/onThisDay.ts");
const { default: Dexie } = await import("dexie");
const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");

/** Local wall-clock time → epoch ms (month is 1-based). */
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const RealNow = () => Date.now();
/** Move a device's clock to `ts`. */
const setClock = (dev, ts) => void (dev.skew.ms = ts - RealNow());

const servers = [];
after(async () => {
  for (const s of servers) await s.stop();
});
async function server(flavor, opts) {
  const s = await startServer(flavor, opts);
  servers.push(s);
  return s;
}

/* ------------------------------------ streak ------------------------------------ */

test(`[${TZ}] re-reading a chapter no longer breaks the streak`, async () => {
  const A = await device("A");
  setClock(A, at(2026, 9, 23, 7, 30));
  await A.repos.recordProgress("JHN", 3);
  setClock(A, at(2026, 9, 24, 21, 0));
  await A.repos.recordProgress("JHN", 4);
  setClock(A, at(2026, 9, 25, 6, 15));
  await A.repos.recordProgress("JHN", 3); // John 3 again: progress forgets the 23rd
  const now = at(2026, 9, 25, 10);

  const oldWay = readingDayKeys((await A.db.progress.toArray()).map((p) => p.at));
  assert.deepEqual(readingStreak(oldWay, now), { days: 2, includesToday: true }, "the old progress-only streak lost a day");

  const days = await A.readingLog.readingDaysFromDb();
  assert.deepEqual([...days].sort(), ["2026-09-23", "2026-09-24", "2026-09-25"]);
  assert.deepEqual(readingStreak(days, now), { days: 3, includesToday: true });
  assert.equal(await A.db.readingLog.count(), 3, "one row per chapter per day");

  // The same chapter again the same day changes nothing (no row, no sync traffic).
  const before = await A.db.outbox.count();
  setClock(A, at(2026, 9, 25, 20, 0));
  await A.readingLog.logChapterRead("JHN", 3, "reader");
  assert.equal(await A.db.readingLog.count(), 3);
  assert.equal((await A.db.readingLog.get("2026-09-25:John.3")).at, at(2026, 9, 25, 6, 15), "the first read of the day is kept");
  assert.equal(await A.db.outbox.count(), before);
});

test(`[${TZ}] early-morning and late-night reads land on their local day`, async () => {
  const A = await device("A");
  // 07:00 in Perth is 23:00 UTC the day before; 23:30 in New York is the next day in UTC.
  setClock(A, at(2026, 9, 24, 7, 0));
  await A.repos.recordProgress("PSA", 1);
  setClock(A, at(2026, 9, 24, 23, 30));
  await A.repos.recordProgress("PSA", 2);
  const rows = await A.db.readingLog.toArray();
  assert.deepEqual(rows.map((r) => r.dayKey), ["2026-09-24", "2026-09-24"]);
});

test(`[${TZ}] streak across daylight-saving changes, and the longest streak`, () => {
  // New York: clocks go back on 1 Nov 2026 and forward on 8 Mar 2026.
  const nov = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"];
  assert.deepEqual(readingStreak(new Set(nov), at(2026, 11, 2, 20)), { days: 4, includesToday: true });
  assert.deepEqual(readingStreak(new Set(nov), at(2026, 11, 3, 0, 30)), { days: 4, includesToday: false }, "alive until the day ends");
  assert.deepEqual(readingStreak(new Set(nov), at(2026, 11, 4, 0, 30)), { days: 0, includesToday: false });
  const mar = ["2026-03-07", "2026-03-08", "2026-03-09"];
  assert.deepEqual(readingStreak(new Set(mar), at(2026, 3, 9, 1)), { days: 3, includesToday: true });
  assert.equal(longestStreak([...mar, ...nov, "2026-05-01"]), 4);
  assert.equal(longestStreak(["2026-03-08", "2026-03-10"]), 1);
  assert.equal(longestStreak(["2024-02-28", "2024-02-29", "2024-03-01", "2024-12-31", "2025-01-01"]), 3);
  assert.equal(longestStreak([]), 0);
});

/* ------------------------------ writers of the log ------------------------------ */

const customPlan = {
  id: "custom-test",
  name: "Test plan",
  description: "",
  days: [
    [{ ho: "GEN", chapter: 1 }, { ho: "PSA", chapter: 1 }],
    [{ ho: "GEN", chapter: 2 }, { ho: "PSA", chapter: 2 }],
  ],
  createdAt: 1,
};

test(`[${TZ}] plan ticks, a plan day marked done and audio completions are all logged`, async () => {
  const A = await device("A");
  await A.db.customPlans.put(customPlan);
  setClock(A, at(2026, 9, 25, 8));
  await A.repos.setChapterDone("custom-test", 0, 0, true, 2);
  let row = await A.db.readingLog.get("2026-09-25:Gen.1");
  assert.equal(row?.source, "plan");
  // Narration heard last night, collected natively and recorded this morning.
  await A.repos.setChapterDone("custom-test", 0, 1, true, 2, { source: "audio", at: at(2026, 9, 24, 22, 45) });
  row = await A.db.readingLog.get("2026-09-24:Ps.1");
  assert.equal(row?.source, "audio");
  assert.equal(row?.at, at(2026, 9, 24, 22, 45));
  // Un-ticking is not a reading.
  await A.repos.setChapterDone("custom-test", 0, 1, false, 2);
  assert.equal(await A.db.readingLog.count(), 2);
  // "Mark done" on the dashboard: every reading of the day.
  await A.repos.setDayDone("custom-test", 1, true);
  assert.ok(await A.db.readingLog.get("2026-09-25:Gen.2"));
  assert.ok(await A.db.readingLog.get("2026-09-25:Ps.2"));
  // Audio in the plain reader.
  await A.repos.recordProgress("ROM", 8, 1, "audio");
  assert.equal((await A.db.readingLog.get("2026-09-25:Rom.8"))?.source, "audio");
  // A plan that can't be resolved still ticks; nothing is logged and nothing throws.
  await A.repos.setChapterDone("no-such-plan", 0, 0, true, 1);
  assert.deepEqual((await A.db.plans.get("no-such-plan")).completedDays, [0]);
});

/* ----------------------------- upgrade + backfill ------------------------------ */

/** A database as v0.5-before-this-change left it (schema version 10), seeded. */
async function legacyDatabase(seed) {
  const idb = new IDBFactory();
  const old = new Dexie("bread-of-life", { indexedDB: idb, IDBKeyRange });
  old.version(1).stores({
    highlights: "id, osis, bbcccvvv, color, createdAt",
    notes: "id, osis, bbcccvvv, updatedAt",
    prayers: "id, status, category, createdAt, answeredAt",
    journal: "id, createdAt, updatedAt, *tags, *linkedOsis",
    progress: "chapterOsis, at",
    settings: "key",
    commentary: "key, fetchedAt",
  });
  old.version(2).stores({ bibleCache: "key, fetchedAt" });
  old.version(3).stores({ plans: "planId" });
  old.version(4).stores({ devotions: "id, completedAt" });
  old.version(5).stores({ customPlans: "id, createdAt" });
  old.version(6).stores({ outbox: "key, at", syncState: "key" });
  old.version(8).stores({
    journal: "id, createdAt, updatedAt, *tags, *linkedOsis, *linkedPrayerIds",
    prayers: "id, status, category, createdAt, answeredAt, *linkedJournalIds",
  });
  old.version(9).stores({ memory: "id, osis, bbcccvvv, dueAt, createdAt" });
  old.version(10).stores({ syncHeld: "key" });
  await old.open();
  await seed(old);
  old.close();
  return idb;
}

test(`[${TZ}] upgrading backfills the log from progress and plan completions, once`, async () => {
  const idb = await legacyDatabase(async (old) => {
    // Chapter reads: only each chapter's LATEST day survives in progress.
    await old.table("progress").bulkPut([
      { chapterOsis: "John.1", ho: "JHN", chapter: 1, lastVerse: 1, at: at(2026, 9, 22, 7, 10) },
      { chapterOsis: "John.2", ho: "JHN", chapter: 2, lastVerse: 1, at: at(2026, 9, 25, 6, 5) },
    ]);
    await old.table("customPlans").put(customPlan);
    await old.table("plans").put({
      planId: "custom-test",
      startedAt: at(2026, 9, 20),
      completedDays: [0],
      completedAt: { 0: at(2026, 9, 23, 21, 0) },
      chapterProgress: { 0: [0, 1], 1: [0] },
      dayAt: { 0: at(2026, 9, 23, 21, 0), 1: at(2026, 9, 24, 8, 0) },
    });
  });
  const A = await device("A", { restartOf: { idb, skew: { ms: 0 }, localStorage: undefined, db: { close() {} } } });
  setClock(A, at(2026, 9, 25, 12));

  // Before the backfill, the streak already sees the progress days (no collapse at start-up).
  const early = await A.readingLog.readingDaysFromDb();
  assert.ok(early.has("2026-09-22") && early.has("2026-09-25"));

  assert.equal(await A.readingLog.backfillReadingLog(), 5);
  const ids = (await A.db.readingLog.toArray()).map((r) => r.id).sort();
  assert.deepEqual(ids, [
    "2026-09-22:John.1",
    "2026-09-23:Gen.1", // plan day 0, completed on the 23rd
    "2026-09-23:Ps.1",
    "2026-09-24:Gen.2", // half-finished day 1, ticked on the 24th
    "2026-09-25:John.2",
  ]);
  const days = await A.readingLog.readingDaysFromDb();
  assert.deepEqual(readingStreak(days, at(2026, 9, 25, 12)), { days: 4, includesToday: true });

  // Backfilled rows go to the account like any other write; the flag stays on this device.
  const queued = (await A.db.outbox.toArray()).map((e) => e.key);
  assert.equal(queued.filter((k) => k.startsWith("readingLog:")).length, 5);
  assert.ok(!queued.includes("settings:readingLog.backfilled"));

  // Once only.
  assert.equal(await A.readingLog.backfillReadingLog(), 0);
  await A.repos.recordProgress("JHN", 3);
  await A.db.settings.delete("readingLog.backfilled");
  assert.equal(await A.readingLog.backfillReadingLog(), 0, "re-running adds nothing already there");
});

/* ------------------------------------- sync ------------------------------------- */

async function signedIn(srv, email, name) {
  const d = await device(name);
  const r = (await d.sync.signup("selfhost", srv.url, email, "password123")).ok
    ? { ok: true }
    : await d.sync.login("selfhost", srv.url, email, "password123");
  assert.ok(r.ok, `sign-in failed: ${JSON.stringify(r)}`);
  await d.sync.syncNow();
  return d;
}
async function syncAll(...devices) {
  for (let i = 0; i < 2; i++) for (const d of devices) await d.sync.syncNow();
}

test(`[${TZ}] reading-log rows merge between two devices`, async () => {
  const srv = await server("current");
  const A = await signedIn(srv, `log-${TZ}@x.org`, "A");
  const B = await signedIn(srv, `log-${TZ}@x.org`, "B");
  setClock(A, at(2026, 9, 24, 8));
  setClock(B, at(2026, 9, 24, 19));
  await A.repos.recordProgress("JHN", 3);
  await B.repos.recordProgress("JHN", 3); // the same chapter the same day, on the phone
  setClock(B, at(2026, 9, 25, 7));
  await B.repos.recordProgress("JHN", 4);
  await syncAll(A, B);

  const idsA = (await A.db.readingLog.toArray()).map((r) => r.id).sort();
  const idsB = (await B.db.readingLog.toArray()).map((r) => r.id).sort();
  assert.deepEqual(idsA, ["2026-09-24:John.3", "2026-09-25:John.4"]);
  assert.deepEqual(idsB, idsA);
  assert.equal((await serverRows(srv)).filter((r) => r.tbl === "readingLog").length, 2);
  assert.deepEqual(readingStreak(await A.readingLog.readingDaysFromDb(), at(2026, 9, 25, 9)), { days: 2, includesToday: true });
  assert.equal(await A.db.outbox.count(), 0);
  assert.equal(await B.db.outbox.count(), 0);
});

test(`[${TZ}] a server without the table: nothing is stuck, and it all goes up after the upgrade`, async () => {
  const old = await server("v0.4.0");
  const A = await signedIn(old, `gate-${TZ}@x.org`, "A");
  setClock(A, at(2026, 9, 24, 8));
  await A.repos.recordProgress("JHN", 3);
  await A.db.notes.put({ id: "John.3.16", osis: "John.3.16", bbcccvvv: 43003016, body: "n", createdAt: 1, updatedAt: 1 });
  await A.sync.syncNow();
  await A.sync.syncNow();
  const status = await A.sync.getSyncStatus();
  assert.equal(status.stuck, 0, "no reading-log row parked as stuck");
  assert.equal(status.pending, 0);
  const rows = await serverRows(old);
  assert.ok(rows.some((r) => r.tbl === "notes"), "the rest still syncs");
  assert.ok(!rows.some((r) => r.tbl === "readingLog"));
  assert.equal(await A.db.readingLog.count(), 1, "kept on the device");
  await old.stop();

  // The server is upgraded (same database, new process).
  const srv = await server("current", { dir: old.dir });
  const st = await A.db.syncState.get("main");
  await A.db.syncState.put({ key: "main", value: { ...st.value, url: srv.url } });
  await A.sync.syncNow();
  assert.ok((await serverRows(srv)).some((r) => r.tbl === "readingLog" && r.id === "2026-09-24:John.3"));
  const B = await signedIn(srv, `gate-${TZ}@x.org`, "B");
  assert.ok(await B.db.readingLog.get("2026-09-24:John.3"), "a new device receives the history");
});

/* --------------------------------- history page --------------------------------- */

test(`[${TZ}] heat-map: a year of whole weeks ending this week, one cell per calendar day`, () => {
  const now = at(2026, 11, 4, 9); // a Wednesday, just after New York's DST change
  const counts = chaptersPerDay(
    [
      { dayKey: "2026-11-01", osis: "John.1", ho: "JHN", chapter: 1, at: 0 },
      { dayKey: "2026-11-01", osis: "John.2", ho: "JHN", chapter: 2, at: 0 },
    ],
    ["2026-11-02", "2026-11-01"],
  );
  assert.equal(counts.get("2026-11-01"), 2, "progress-only days never add to logged ones");
  assert.equal(counts.get("2026-11-02"), 1);
  const weeks = heatmapWeeks(counts, now, 53, "en-US");
  assert.equal(weeks.length, 53);
  const cells = weeks.flatMap((w) => w.cells);
  for (let i = 1; i < cells.length; i++) {
    const [y, m, d] = cells[i - 1].key.split("-").map(Number);
    assert.equal(cells[i].key, localDayKey(new Date(y, m - 1, d + 1, 12).getTime()), `consecutive at ${cells[i].key}`);
  }
  assert.equal(new Date(at(...cells[0].key.split("-").map(Number))).getDay(), 0, "columns start on Sunday");
  const last = weeks[52].cells;
  assert.ok(last.some((c) => c.key === "2026-11-04" && !c.future));
  assert.ok(last.filter((c) => c.future).map((c) => c.key).join() === "2026-11-05,2026-11-06,2026-11-07");
  assert.equal(cells.find((c) => c.key === "2026-11-01").count, 2);
  assert.ok(weeks.some((w) => w.monthLabel === "Nov"));
  assert.deepEqual([0, 1, 2, 3, 4, 6, 7, 20].map(intensity), [0, 1, 2, 2, 3, 3, 4, 4]);
});

test(`[${TZ}] month / year counts, book progress and recent days`, () => {
  const log = [
    { id: "a", dayKey: "2026-09-01", osis: "John.1", ho: "JHN", chapter: 1, at: 3 },
    { id: "b", dayKey: "2026-09-02", osis: "John.1", ho: "JHN", chapter: 1, at: 4 },
    { id: "c", dayKey: "2026-08-31", osis: "Obad.1", ho: "OBA", chapter: 1, at: 2 },
    { id: "d", dayKey: "2025-12-31", osis: "John.2", ho: "JHN", chapter: 2, at: 1 },
  ];
  const now = at(2026, 9, 15);
  assert.equal(chaptersInPeriod(log, "month", now), 2);
  assert.equal(chaptersInPeriod(log, "year", now), 3);
  const books = bookProgress(
    [
      { ho: "OBA", name: "Obadiah", testament: "OT", chapters: 1 },
      { ho: "JHN", name: "John", testament: "NT", chapters: 21 },
    ],
    [...log, { ho: "JHN", chapter: 3 }, { ho: "JHN", chapter: 99 }],
  );
  assert.deepEqual(books.map((b) => [b.ho, b.read, b.total]), [["OBA", 1, 1], ["JHN", 3, 21]]);
  const recent = recentDays(log, 2);
  assert.deepEqual(recent.map((d) => d.dayKey), ["2026-09-02", "2026-09-01"]);
});

/* ---------------------------------- on this day --------------------------------- */

test(`[${TZ}] on this day: earlier years only, local days, newest first`, () => {
  const now = at(2026, 9, 27, 8);
  const prayers = [
    { id: "p1", title: "Dad's surgery", status: "answered", answeredAt: at(2025, 9, 27, 7, 30), answerNote: "He came home." },
    { id: "p2", title: "Not today", status: "answered", answeredAt: at(2025, 9, 26, 23, 59), answerNote: null },
    { id: "p3", title: "This year", status: "answered", answeredAt: at(2026, 9, 27, 6), answerNote: null },
    { id: "p4", title: "Still praying", status: "active", answeredAt: null, answerNote: null },
    { id: "p5", title: "Long ago", status: "answered", answeredAt: at(2023, 9, 27, 0, 0), answerNote: null },
  ];
  const journal = [{ id: "j1", title: "Psalm 23", text: "The Lord is my shepherd", createdAt: at(2025, 9, 27, 21) }];
  const m = memoriesOnThisDay(now, prayers, journal);
  assert.deepEqual(m.map((x) => [x.kind, x.id, x.yearsAgo]), [
    ["answered", "p1", 1],
    ["journal", "j1", 1],
    ["answered", "p5", 3],
  ]);
  assert.equal(yearsAgoLabel(1), "A year ago today");
  assert.equal(yearsAgoLabel(3), "3 years ago today");
  assert.deepEqual(memoriesOnThisDay(now, [prayers[1], prayers[2]], []), [], "nothing to show");
});

test(`[${TZ}] on this day: 29 February comes round on the 28th`, () => {
  const w = dayWindows(at(2027, 2, 28, 9), 2023);
  assert.deepEqual(w.map((x) => x.yearsAgo), [1, 2, 3, 4]);
  const m = memoriesOnThisDay(
    at(2027, 2, 28, 9),
    [{ id: "leap", title: "Leap day", status: "answered", answeredAt: at(2024, 2, 29, 10), answerNote: null }],
    [],
  );
  assert.deepEqual(m.map((x) => [x.id, x.yearsAgo]), [["leap", 3]]);
  // On a leap year's 29th, only earlier leap years match.
  assert.deepEqual(dayWindows(at(2028, 2, 29, 9), 2023).map((x) => x.yearsAgo), [4]);
});

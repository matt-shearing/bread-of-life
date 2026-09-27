/**
 * Sync tests: the REAL client code (src/db/{index,sync,syncTracking,crypto,planMerge}.ts
 * and repos.ts) running as several devices, each with its own fake-indexeddb, storage and
 * clock, against a real sync server in a child process.
 *
 * Run: pnpm test:sync   (or: node --test-reporter=spec scripts/test-sync.mjs)
 *
 * Every case runs twice: against the v0.4.0 server (production runs it until the next
 * deploy, so every client fix must work with it) and against the current server.
 * Needs Node 23.6+ (the TypeScript sources are imported directly).
 */
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { device } from "./lib/sync-devices.mjs";
import { startServer, serverRows, post } from "./lib/sync-server.mjs";

/* ------------------------------- network hooks ------------------------------- */

const realFetch = globalThis.fetch;
/** Test hooks: `before(url, init)` may return a Response; `after(url, init)` runs before the client sees the response. */
const net = { before: null, after: null, log: [] };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const early = net.before ? await net.before(u, init) : undefined;
  if (early) return early;
  const res = await realFetch(url, init);
  const text = await res.text();
  net.log.push({ url: u, req: init?.body ?? null, status: res.status, body: text });
  if (net.after) await net.after(u, init, text);
  return new Response(text, { status: res.status, headers: res.headers });
};
const resetNet = () => {
  net.before = null;
  net.after = null;
  net.log.length = 0;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const servers = [];
after(async () => {
  for (const s of servers) await s.stop();
});

async function server(flavor, opts) {
  const s = await startServer(flavor, opts);
  servers.push(s);
  return s;
}

/** Sign a new device in (signup for the first, login after). */
async function signedIn(srv, email, opts = {}) {
  const d = await device(opts.name, opts);
  const r = (await d.sync.signup("selfhost", srv.url, email, "password123")).ok
    ? { ok: true }
    : await d.sync.login("selfhost", srv.url, email, "password123");
  assert.ok(r.ok, `sign-in failed: ${JSON.stringify(r)}`);
  await d.sync.syncNow();
  return d;
}

/** Sync the devices in turn, twice, so every change has reached everyone. */
async function syncAll(...devices) {
  for (let i = 0; i < 2; i++) for (const d of devices) await d.sync.syncNow();
}

const journal = (id, body, extra = {}) => ({ id, title: "t", body, tags: [], linkedOsis: [], source: "manual", createdAt: 1, updatedAt: 1, ...extra });
const note = (id, body) => ({ id, osis: id, bbcccvvv: 1, body, createdAt: 1, updatedAt: 1 });
const rowOf = async (srv, tbl, id) => (await serverRows(srv)).find((r) => r.tbl === tbl && r.id === id);

for (const flavor of ["v0.4.0", "current"]) {
  describe(`against the ${flavor} server`, () => {
    test("B1: an edit made while a push is in flight is not dropped from the outbox", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b1@x.org");
      await A.db.journal.put(journal("j1", "v1"));
      net.after = async (url) => {
        if (!url.endsWith("/push")) return;
        net.after = null;
        await A.db.journal.update("j1", { body: "v2-typed-during-push" });
      };
      await A.sync.syncNow();
      assert.equal((await A.db.outbox.toArray()).filter((e) => e.key === "journal:j1").length, 1, "the newer edit stays queued");
      await A.sync.syncNow();
      assert.equal((await rowOf(srv, "journal", "j1")).data.body, "v2-typed-during-push");
      assert.equal(await A.db.outbox.count(), 0);
    });

    test("B13: a write and its outbox entry commit together", async () => {
      const A = await device("A");
      await A.db.notes.put(note("John.1.1", "x"));
      assert.equal((await A.db.outbox.get("notes:John.1.1"))?.op, "upsert", "queued with no timer in between");
      await assert.rejects(
        A.db.transaction("rw", A.db.notes, async () => {
          await A.db.notes.put(note("John.1.2", "y"));
          throw new Error("abort");
        }),
      );
      assert.equal(await A.db.outbox.get("notes:John.1.2"), undefined, "an aborted write leaves no entry");
    });

    test("B2: a device whose clock runs fast doesn't make later edits vanish", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b2@x.org");
      const B = await signedIn(srv, "b2@x.org", { skewMs: 10 * 60_000 }); // phone 10 minutes fast
      await B.db.notes.put(note("John.3.16", "B's note"));
      await syncAll(B, A);
      assert.equal((await A.db.notes.get("John.3.16")).body, "B's note");
      await A.db.notes.update("John.3.16", { body: "A's later correction" });
      await syncAll(A, B);
      assert.equal((await A.db.notes.get("John.3.16")).body, "A's later correction");
      assert.equal((await B.db.notes.get("John.3.16")).body, "A's later correction");
      assert.equal((await rowOf(srv, "notes", "John.3.16")).data.body, "A's later correction");
      assert.equal(await A.db.outbox.count(), 0);
    });

    test("B2: a push the server ignores is not cleared until the server's copy is here", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b2b@x.org");
      // Someone else wrote a far-future copy that A has never pulled.
      const { data } = await post(srv, "/auth/login", { email: "b2b@x.org", password: "password123" });
      await post(srv, "/push", { changes: [{ table: "notes", id: "Ps.1.1", updatedAt: Date.now() + 3_600_000, deleted: false, data: note("Ps.1.1", "future") }] }, data.token);
      const s = await A.sync.getState();
      const top = Math.max(...(await serverRows(srv)).map((r) => r.seq));
      await A.db.syncState.put({ key: "main", value: { ...s, cursor: top } }); // A never saw it
      await A.db.notes.put(note("Ps.1.1", "A's edit"));
      await A.sync.syncNow();
      await A.sync.syncNow();
      const onServer = (await rowOf(srv, "notes", "Ps.1.1")).data.body;
      assert.equal((await A.db.notes.get("Ps.1.1")).body, onServer, "A converged on the server's copy");
      assert.equal(await A.db.outbox.count(), 0, "nothing left pending");
    });

    test("B3: an older remote delete doesn't remove a newer local edit", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b3@x.org");
      const B = await signedIn(srv, "b3@x.org");
      await A.db.highlights.put({ id: "Rom.8.28", osis: "Rom.8.28", bbcccvvv: 45008028, color: "amber", createdAt: 1 });
      await syncAll(A, B);
      await B.db.highlights.delete("Rom.8.28");
      await B.sync.syncNow();
      await sleep(5);
      // A re-highlights (later) while its pull of B's delete is in flight.
      net.after = async (url) => {
        if (!url.endsWith("/pull")) return;
        net.after = null;
        await A.db.highlights.put({ id: "Rom.8.28", osis: "Rom.8.28", bbcccvvv: 45008028, color: "rose", createdAt: 2 });
      };
      await A.sync.syncNow();
      await syncAll(A, B);
      assert.equal((await A.db.highlights.get("Rom.8.28"))?.color, "rose");
      assert.equal((await B.db.highlights.get("Rom.8.28"))?.color, "rose");
      const row = await rowOf(srv, "highlights", "Rom.8.28");
      assert.equal(row.deleted, 0);
    });

    test("B3: a queued upsert for a row a pull deleted does not push a new delete", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b3b@x.org");
      await A.db.notes.put(note("Gen.1.1", "x"));
      await A.sync.syncNow();
      const row = await rowOf(srv, "notes", "Gen.1.1");
      // A stale entry left behind (as the old hooks could) for a row that is gone.
      await A.db.transaction("rw", A.db.notes, A.db.outbox, async (tx) => {
        A.tracking.untracked(tx);
        await A.db.notes.delete("Gen.1.1");
        await A.db.outbox.put({ key: "notes:Gen.1.1", table: "notes", id: "Gen.1.1", op: "upsert", at: Date.now() });
      });
      await A.sync.syncNow();
      assert.equal((await rowOf(srv, "notes", "Gen.1.1")).seq, row.seq, "the server row is untouched");
      assert.equal(await A.db.outbox.count(), 0);
    });

    test("B4: plan days finished offline on two devices both survive, and un-ticking wins over an older tick", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b4@x.org");
      const B = await signedIn(srv, "b4@x.org");
      for (const d of [0, 1, 2, 3, 4]) await A.repos.setDayDone("mcheyne", d, true);
      await syncAll(A, B);
      await A.repos.setDayDone("mcheyne", 5, true); // phone, in the car, offline
      await A.repos.setChapterDone("mcheyne", 7, 0, true, 4);
      await sleep(3);
      await B.repos.setDayDone("mcheyne", 6, true); // desktop, offline
      await B.repos.setChapterDone("mcheyne", 7, 1, true, 4);
      await syncAll(A, B);
      const a = await A.db.plans.get("mcheyne");
      const b = await B.db.plans.get("mcheyne");
      assert.deepEqual(a.completedDays, [0, 1, 2, 3, 4, 5, 6]);
      assert.deepEqual(b.completedDays, [0, 1, 2, 3, 4, 5, 6]);
      // Day 7 was touched on both: the later change (B's) wins that day.
      assert.deepEqual(a.chapterProgress[7], [1]);
      // The guided reader un-ticks day 5 on the desktop; the phone's older tick loses.
      await sleep(3);
      await B.repos.setDayDone("mcheyne", 5, false);
      await syncAll(B, A);
      assert.deepEqual((await A.db.plans.get("mcheyne")).completedDays, [0, 1, 2, 3, 4, 6]);
      assert.deepEqual((await B.db.plans.get("mcheyne")).completedDays, [0, 1, 2, 3, 4, 6]);
      assert.deepEqual((await rowOf(srv, "plans", "mcheyne")).data.completedDays, [0, 1, 2, 3, 4, 6]);
    });

    test("B4: rows from before per-day stamps merge as a union", async () => {
      const merge = (await import("../src/db/planMerge.ts")).mergePlans;
      const m = merge(
        { planId: "p", startedAt: 5, completedDays: [0, 1, 5], chapterProgress: { 2: [0] } },
        { planId: "p", startedAt: 3, completedDays: [0, 1, 6], chapterProgress: { 2: [1] } },
      );
      assert.deepEqual(m.completedDays, [0, 1, 5, 6]);
      assert.deepEqual(m.chapterProgress[2], [0, 1]);
      assert.equal(m.startedAt, 3);
    });

    test("B5: device-local settings never leave the device, and pulled ones are ignored", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b5@x.org");
      const B = await signedIn(srv, "b5@x.org");
      await A.db.settings.put({ key: "misslerLibraryPath", value: "/home/contra/missler-library" });
      await A.db.settings.put({ key: "ui.translation", value: "KJV" });
      await syncAll(A, B);
      assert.equal(await rowOf(srv, "settings", "misslerLibraryPath"), undefined, "not uploaded");
      assert.equal((await B.db.settings.get("ui.translation"))?.value, "KJV", "account settings still sync");
      // An older app (v0.4.0) uploads its path anyway.
      const { data } = await post(srv, "/auth/login", { email: "b5@x.org", password: "password123" });
      await post(srv, "/push", { changes: [{ table: "settings", id: "misslerLibraryPath", updatedAt: Date.now(), deleted: false, data: { key: "misslerLibraryPath", value: "/home/x" } }] }, data.token);
      await B.sync.syncNow();
      assert.equal(await B.db.settings.get("misslerLibraryPath"), undefined, "a pulled device-local setting is ignored");
    });

    test("B6: a pull of more than one page catches up in one round, and the round signal waits for it", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b6@x.org");
      const B = await signedIn(srv, "b6@x.org");
      // (settings rows: the table with no secondary indexes, which fake-indexeddb is slow to maintain)
      await A.db.settings.bulkPut(Array.from({ length: 6000 }, (_, i) => ({ key: `ui.test.${i}`, value: i })));
      await A.sync.syncNow();
      const rounds = [];
      const off = B.sync.onSyncRound((r) => rounds.push(r));
      await B.sync.syncNow();
      assert.equal(await B.db.settings.where("key").startsWith("ui.test.").count(), 6000, "all 6000 rows in one round");
      assert.deepEqual(rounds, [{ caughtUp: true }]);
      // A failed round says nothing.
      net.before = async (url) => (url.endsWith("/pull") ? new Response("", { status: 502 }) : undefined);
      await B.sync.syncNow();
      assert.equal(rounds.length, 1, "no round signal after a failed pull");
      net.before = null;
      off();
    });

    test("B7: pushes are chunked and one row the server refuses doesn't block the rest", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b7@x.org");
      await A.db.journal.bulkPut(Array.from({ length: 40 }, (_, i) => journal(`j${i}`, "x".repeat(40_000))));
      await A.db.journal.put(journal("poison", "POISON"));
      // Stand-in for a row that fails the whole batch on the server.
      net.before = async (url, init) => (url.endsWith("/push") && String(init.body).includes("POISON") ? new Response(JSON.stringify({ error: "boom" }), { status: 500 }) : undefined);
      await A.sync.syncNow();
      net.before = null;
      const pushes = net.log.filter((l) => l.url.endsWith("/push") && l.status === 200 && l.req.length > 100);
      assert.ok(pushes.length >= 2, "split into several requests");
      assert.ok(pushes.every((p) => p.req.length <= 1_100_000), "each request is bounded");
      const stored = (await serverRows(srv)).filter((r) => r.tbl === "journal");
      assert.equal(stored.length, 40, "every other row uploaded");
      const status = await A.sync.getSyncStatus();
      assert.equal(status.pending, 1, "the refused row stays queued, not dropped");
    });

    test("S2: turning on encryption re-uploads existing personal content encrypted", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await device("A");
      await A.db.journal.put(journal("j1", "my private confession"));
      await A.db.prayers.put({ id: "p1", title: "Pray for X's diagnosis", body: "", category: "family", status: "active", prayedCount: 0, lastPrayedAt: null, createdAt: 1, answeredAt: null, answerNote: null, linkedOsis: [] });
      await A.sync.signup("selfhost", srv.url, "s2@x.org", "password123");
      await A.sync.syncNow();
      assert.equal((await rowOf(srv, "journal", "j1")).data.body, "my private confession");
      const r = await A.sync.enableE2E();
      assert.ok(r.ok);
      await A.sync.syncNow();
      for (const row of (await serverRows(srv)).filter((x) => ["journal", "prayers", "notes"].includes(x.tbl))) {
        assert.equal(typeof row.data.__enc, "string", `${row.tbl}/${row.id} is encrypted on the server`);
        assert.ok(!JSON.stringify(row.data).includes("confession"));
      }
      assert.equal(await A.db.outbox.count(), 0);
    });

    test("S1: pulled plaintext for an encrypted table is refused once the account encrypts", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "s1@x.org");
      assert.ok((await A.sync.enableE2E()).ok);
      await A.sync.syncNow();
      const { data } = await post(srv, "/auth/login", { email: "s1@x.org", password: "password123" });
      await post(srv, "/push", { changes: [{ table: "journal", id: "evil", updatedAt: Date.now(), deleted: false, data: journal("evil", "<img src=x onerror=alert(1)>") }] }, data.token);
      await A.sync.syncNow();
      assert.equal(await A.db.journal.get("evil"), undefined);
    });

    test("B10 + B11: a second device is told to enter the phrase, keeps locked rows across a restart, and unlocks them", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "e2e@x.org");
      await A.db.journal.put(journal("j1", "secret"));
      const on = await A.sync.enableE2E();
      assert.ok(on.ok);
      await A.sync.syncNow();

      let B = await signedIn(srv, "e2e@x.org");
      assert.equal(await B.db.journal.get("j1"), undefined, "unreadable here");
      assert.equal((await B.sync.getE2EStatus()).needsKey, true);
      assert.deepEqual(await B.sync.enableE2E(), { ok: false, reason: "account-has-key" }, "no second key");
      // Journal edits made here wait for the key instead of going up readable.
      await B.db.journal.put(journal("j2", "written on B"));
      await B.sync.syncNow();
      assert.equal(await rowOf(srv, "journal", "j2"), undefined);
      assert.equal((await B.sync.getSyncStatus()).waitingForKey, 1);

      B = await device("B", { restartOf: B }); // app restart
      assert.equal((await B.sync.getE2EStatus()).needsKey, true, "still flagged after a restart");
      const other = await A.crypto.keyToPhrase(A.crypto.generateDataKey());
      assert.equal(await B.sync.restoreE2E(other), "mismatch", "a phrase for another key is refused");
      assert.equal(await B.sync.restoreE2E("not a phrase"), "invalid");
      assert.equal(await B.sync.restoreE2E(on.phrase), "ok");
      assert.equal((await B.db.journal.get("j1"))?.body, "secret", "held row unlocked");
      await B.sync.syncNow();
      assert.equal(typeof (await rowOf(srv, "journal", "j2")).data.__enc, "string", "the waiting edit uploaded, encrypted");
      await A.sync.syncNow();
      assert.equal((await A.db.journal.get("j2"))?.body, "written on B");
      assert.equal((await B.sync.getE2EStatus()).needsKey, false);
    });

    test("B12: signing in to a different account doesn't upload the previous account's data without asking", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "alice@x.org");
      await A.db.journal.put(journal("j1", "alice's entry"));
      await A.sync.syncNow();
      await A.sync.signOut();
      const r = await A.sync.signup("selfhost", srv.url, "bob@x.org", "password123");
      assert.deepEqual(r, { ok: true, needsAccountChoice: true });
      await A.sync.syncNow();
      const bobRows = async () => {
        const { data } = await post(srv, "/auth/login", { email: "bob@x.org", password: "password123" });
        return (await post(srv, "/pull", { since: 0 }, data.token)).data.changes;
      };
      assert.deepEqual(await bobRows(), [], "nothing uploaded before the user chooses");
      await A.sync.resolveAccountChoice("keep-local");
      await A.sync.syncNow();
      assert.equal((await bobRows()).filter((c) => c.table === "journal").length, 0);
      assert.equal((await A.db.journal.get("j1"))?.body, "alice's entry", "still on the device");
    });

    test("B14: a row from before sync existed doesn't beat a newer server copy", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b14@x.org");
      await A.db.notes.put(note("Ps.23.1", "current text"));
      await A.sync.syncNow();
      const B = await device("B");
      await B.db.transaction("rw", B.db.notes, async (tx) => {
        B.tracking.untracked(tx);
        await B.db.notes.put({ id: "Ps.23.1", osis: "Ps.23.1", bbcccvvv: 1, body: "old pre-sync text", createdAt: 1 }); // no updatedAt
      });
      await B.sync.login("selfhost", srv.url, "b14@x.org", "password123");
      await syncAll(B, A);
      assert.equal((await rowOf(srv, "notes", "Ps.23.1")).data.body, "current text");
      assert.equal((await B.db.notes.get("Ps.23.1")).body, "current text");
      assert.equal(await B.db.outbox.count(), 0);
    });

    test("B17: a refused token shows as signed out and stops the round", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b17@x.org");
      const s = await A.sync.getState();
      await A.db.syncState.put({ key: "main", value: { ...s, token: s.token.slice(0, -2) + "xx" } });
      await A.db.notes.put(note("Ps.1.1", "x"));
      await A.sync.syncNow();
      const status = await A.sync.getSyncStatus();
      assert.equal(status.signedOut, true);
      assert.equal(status.pending, 1, "the change waits for the new sign-in");
      const r = await A.sync.login("selfhost", srv.url, "b17@x.org", "password123");
      assert.ok(r.ok && !r.needsAccountChoice, "same account: no prompt");
      await A.sync.syncNow();
      assert.equal((await A.sync.getSyncStatus()).signedOut, false);
      assert.equal((await rowOf(srv, "notes", "Ps.1.1")).data.body, "x");
    });

    test("B9: devotion completions carry the year; older keys are converted on arrival", async () => {
      resetNet();
      const srv = await server(flavor);
      const A = await signedIn(srv, "b9@x.org");
      const { data } = await post(srv, "/auth/login", { email: "b9@x.org", password: "password123" });
      const at = new Date(2026, 8, 25, 7).getTime();
      await post(srv, "/push", { changes: [{ table: "devotions", id: "spurgeon-morning-evening:09-25:0", updatedAt: at, deleted: false, data: { id: "spurgeon-morning-evening:09-25:0", completedAt: at } }] }, data.token);
      await A.sync.syncNow();
      assert.ok(await A.db.devotions.get("spurgeon-morning-evening:2026-09-25:0"));
      assert.equal(await A.db.devotions.get("spurgeon-morning-evening:09-25:0"), undefined);
    });

    if (flavor === "current") {
      test("B18: this device's own writes are not sent back to it", async () => {
        resetNet();
        const srv = await server(flavor);
        const A = await signedIn(srv, "b18@x.org");
        await A.db.progress.bulkPut(Array.from({ length: 200 }, (_, i) => ({ chapterOsis: `X.${i}`, ho: "GEN", chapter: i, lastVerse: 1, at: 1 })));
        net.log.length = 0;
        await A.sync.syncNow();
        const pulls = net.log.filter((l) => l.url.endsWith("/pull"));
        assert.ok(pulls.every((p) => JSON.parse(p.body).changes.length === 0), "no echo");
        assert.equal(await A.db.outbox.count(), 0);
      });

      test("S3: a server that offers account deletion lets the app delete the account", async () => {
        resetNet();
        const srv = await server(flavor);
        const A = await signedIn(srv, "gone@x.org");
        await A.db.notes.put(note("Ps.1.1", "x"));
        await A.sync.syncNow();
        assert.deepEqual(await A.sync.accountFeatures(), { logoutAll: true, changePassword: true, deleteAccount: true });
        assert.equal((await A.sync.deleteAccount("wrong-password")).ok, false);
        assert.ok((await A.sync.deleteAccount("password123")).ok);
        assert.equal((await serverRows(srv)).length, 0, "server data gone");
        assert.equal((await A.sync.getSyncStatus()).mode, "off");
        assert.equal((await A.db.notes.get("Ps.1.1"))?.body, "x", "the device keeps its own copy");
      });
    } else {
      test("the v0.4.0 server offers no account actions, so the app shows none", async () => {
        const srv = await server(flavor);
        const A = await signedIn(srv, "old@x.org");
        assert.deepEqual(await A.sync.accountFeatures(), { logoutAll: false, changePassword: false, deleteAccount: false });
      });
    }
  });
}

test("S9: plain http:// self-hosted addresses are flagged unless they stay on this machine or network", async () => {
  const { sync } = await device("url");
  assert.equal(sync.isInsecureSyncUrl("http://sync.example.org"), true);
  assert.equal(sync.isInsecureSyncUrl("https://sync.example.org"), false);
  assert.equal(sync.isInsecureSyncUrl("http://localhost:4000"), false);
  assert.equal(sync.isInsecureSyncUrl("http://nas.local:4000"), false);
});

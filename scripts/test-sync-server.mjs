/**
 * Unit tests for deploy/sync-server/server.mjs over HTTP: validation, token expiry and
 * revocation, account deletion, password hashing, the stamp clamp, paging, and the
 * upgrade from a v0.4.0 database (read from git).
 *
 * Run: pnpm test:sync-server   (or: node --test-reporter=spec scripts/test-sync-server.mjs)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startServer, serverRows, post, currentServerPath } from "./lib/sync-server.mjs";

const servers = [];
after(async () => {
  for (const s of servers) await s.stop();
});
async function server(flavor = "current", opts) {
  const s = await startServer(flavor, opts);
  servers.push(s);
  return s;
}
async function account(srv, email = "a@x.org", password = "password123") {
  const r = await post(srv, "/auth/signup", { email, password });
  assert.equal(r.status, 200, r.text);
  return r.data.token;
}
const change = (id, extra = {}) => ({ table: "notes", id, updatedAt: Date.now(), deleted: false, data: { id, body: id }, ...extra });

test("health lists the features clients gate on", async () => {
  const srv = await server();
  const r = await fetch(`${srv.url}/health`).then((x) => x.json());
  assert.equal(r.ok, true);
  for (const f of ["rejected", "no-echo", "more", "refresh", "logout-all", "password", "delete-account"]) assert.ok(r.features.includes(f), f);
});

test("in production the server refuses to start without TOKEN_SECRET", () => {
  const env = { ...process.env, NODE_ENV: "production", TOKEN_SECRET: "", PORT: "0", DB_PATH: ":memory:" };
  const r = spawnSync(process.execPath, [currentServerPath()], { env, encoding: "utf8", timeout: 10_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /TOKEN_SECRET/);
});

test("bad input gets a 400 or 413, not a 500", async () => {
  const srv = await server();
  assert.equal((await post(srv, "/auth/signup", { email: "not-an-email", password: "password123" })).status, 400);
  assert.equal((await post(srv, "/auth/signup", { email: "a@x.org", password: "short" })).status, 400);
  assert.equal((await post(srv, "/auth/signup", "{not json")).status, 400);
  const token = await account(srv);
  assert.equal((await post(srv, "/push", "[1,2]", token)).status, 400);
  const big = JSON.stringify({ changes: [change("big", { data: { body: "x".repeat(9 * 1024 * 1024) } })] });
  assert.equal((await post(srv, "/push", big, token)).status, 413);
  assert.equal((await post(srv, "/auth/signup", { email: "a@x.org", password: "password123" })).status, 409);
});

test("push checks each row: a bad one is rejected and the rest apply", async () => {
  const srv = await server();
  const token = await account(srv);
  const r = await post(srv, "/push", {
    changes: [
      change("ok.1"),
      { table: "notes", id: { x: 1 }, updatedAt: 1, data: {} },
      { table: "anything_i_like", id: "1", updatedAt: 1, data: { blob: "x" } },
      { table: "settings", id: "misslerLibraryPath", updatedAt: 1, data: { key: "misslerLibraryPath", value: "/home/x" } },
      change("ok.2"),
    ],
  }, token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.rejected.map((x) => x.reason), ["invalid", "table", "device-local"]);
  assert.deepEqual((await serverRows(srv)).map((x) => x.id), ["ok.1", "ok.2"]);
});

test("a stale push is rejected, with the server's copy for a v0.5 client", async () => {
  const srv = await server();
  const token = await account(srv);
  await post(srv, "/push", { changes: [change("n", { updatedAt: 2000, data: { id: "n", body: "newer" } })] }, token);
  const old = await post(srv, "/push", { changes: [change("n", { updatedAt: 1000 })] }, token);
  assert.deepEqual(old.data.rejected, [{ table: "notes", id: "n", reason: "stale" }], "a v0.4.0 client gets no copy");
  const v5 = await post(srv, "/push", { deviceId: "dev1", changes: [change("n", { updatedAt: 1000 })] }, token);
  assert.equal(v5.data.rejected[0].current.data.body, "newer");
});

test("a far-future stamp is clamped, so it can't freeze a row", async () => {
  const srv = await server();
  const token = await account(srv);
  const r = await post(srv, "/push", { deviceId: "d", changes: [change("John.1.1", { updatedAt: 8.64e15, data: { body: "poison" } })] }, token);
  assert.ok(r.data.adjusted[0].updatedAt <= Date.now() + 5 * 60_000);
  await new Promise((res) => setTimeout(res, 20));
  const later = await post(srv, "/push", { changes: [change("John.1.1", { updatedAt: Date.now() + 6 * 60_000, data: { body: "real" } })] }, token);
  assert.deepEqual(later.data.rejected, []);
  assert.equal((await serverRows(srv))[0].data.body, "real");
});

test("pull pages report `more`, and a device doesn't get its own writes back", async () => {
  const srv = await server();
  const token = await account(srv);
  await post(srv, "/push", { deviceId: "mine", changes: Array.from({ length: 30 }, (_, i) => change(`m${i}`)) }, token);
  await post(srv, "/push", { deviceId: "other", changes: [change("o1")] }, token);
  const p1 = await post(srv, "/pull", { since: 0, limit: 20 }, token);
  assert.equal(p1.data.changes.length, 20);
  assert.equal(p1.data.more, true);
  const p2 = await post(srv, "/pull", { since: p1.data.cursor, limit: 20 }, token);
  assert.equal(p2.data.more, false);
  assert.equal(p2.data.changes.length, 11);
  const mine = await post(srv, "/pull", { since: 0, deviceId: "mine" }, token);
  assert.deepEqual(mine.data.changes.map((c) => c.id), ["o1"]);
  assert.equal(mine.data.cursor, p2.data.cursor, "the cursor still moves past skipped rows");
});

test("tokens expire, refresh, and are revoked by logout-all and by a password change", async () => {
  const srv = await server("current", { env: { TOKEN_TTL_DAYS: String(1 / 86_400) } }); // one second
  const token = await account(srv);
  const claims = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
  assert.ok(claims.exp > claims.iat);
  const fresh = (await post(srv, "/auth/refresh", {}, token)).data.token;
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await post(srv, "/pull", { since: 0 }, token)).status, 401, "expired");

  const t1 = (await post(srv, "/auth/login", { email: "a@x.org", password: "password123" })).data.token;
  const t2 = (await post(srv, "/auth/login", { email: "a@x.org", password: "password123" })).data.token;
  assert.equal((await post(srv, "/auth/password", { current: "wrong-one", next: "newpassword1" }, t1)).status, 401);
  const changed = await post(srv, "/auth/password", { current: "password123", next: "newpassword1" }, t1);
  assert.equal(changed.status, 200);
  assert.equal((await post(srv, "/pull", { since: 0 }, t2)).status, 401, "other sessions revoked");
  assert.equal((await post(srv, "/pull", { since: 0 }, changed.data.token)).status, 200);
  assert.equal((await post(srv, "/auth/login", { email: "a@x.org", password: "password123" })).status, 401);
  const t3 = (await post(srv, "/auth/login", { email: "a@x.org", password: "newpassword1" })).data.token;
  assert.equal((await post(srv, "/auth/logout-all", {}, t3)).status, 200);
  assert.equal((await post(srv, "/pull", { since: 0 }, t3)).status, 401);
  void fresh;
});

test("deleting an account removes its data and its tokens", async () => {
  const srv = await server();
  const token = await account(srv);
  const other = await account(srv, "b@x.org");
  await post(srv, "/push", { changes: [change("mine")] }, token);
  await post(srv, "/push", { changes: [change("theirs")] }, other);
  assert.equal((await post(srv, "/account/delete", { password: "nope-nope" }, token)).status, 401);
  assert.equal((await post(srv, "/account/delete", { password: "password123" }, token)).status, 200);
  assert.deepEqual((await serverRows(srv)).map((r) => r.id), ["theirs"]);
  assert.equal((await post(srv, "/pull", { since: 0 }, token)).status, 401);
  assert.equal((await post(srv, "/auth/login", { email: "a@x.org", password: "password123" })).status, 401);
});

test("login takes about as long for an unknown email as for a wrong password", async () => {
  const srv = await server("current", { env: { SCRYPT_LOG_N: "15" } });
  await account(srv);
  const time = async (email) => {
    const t = performance.now();
    const r = await post(srv, "/auth/login", { email, password: "wrongpass1" });
    assert.equal(r.status, 401);
    return performance.now() - t;
  };
  await time("warm@x.org");
  const unknown = [await time("nobody@x.org"), await time("nobody2@x.org"), await time("nobody3@x.org")].sort()[1];
  const known = [await time("a@x.org"), await time("a@x.org"), await time("a@x.org")].sort()[1];
  assert.ok(unknown > known / 3 && unknown < known * 3, `unknown ${unknown.toFixed(1)} ms vs known ${known.toFixed(1)} ms`);
});

test("upgrading from a v0.4.0 database: old tokens and passwords work, bad rows are repaired", async () => {
  const old = await server("v0.4.0");
  const token = (await post(old, "/auth/signup", { email: "a@x.org", password: "password123" })).data.token;
  await post(old, "/push", {
    changes: [
      change("frozen", { updatedAt: 8.64e15 }),
      { table: "settings", id: "misslerLibraryPath", updatedAt: 1, deleted: false, data: { key: "misslerLibraryPath", value: "/home/x" } },
    ],
  }, token);
  await old.stop();

  const srv = await server("current", { dir: old.dir });
  assert.equal((await post(srv, "/pull", { since: 0 }, token)).status, 200, "a v0.4.0 token still works");
  const rows = await serverRows(srv);
  assert.ok(rows.find((r) => r.id === "frozen").updated_at <= Date.now() + 5 * 60_000, "future stamp repaired");
  assert.equal(rows.find((r) => r.id === "misslerLibraryPath"), undefined, "device-local setting removed");

  assert.equal((await post(srv, "/auth/login", { email: "a@x.org", password: "password123" })).status, 200, "old hash verifies");
  const d = new DatabaseSync(path.join(srv.dir, "sync.db"), { readOnly: true });
  assert.match(d.prepare("SELECT pwhash FROM accounts").get().pwhash, /^scrypt\$/, "rehashed with the stronger parameters");
  d.close();
  await post(srv, "/auth/logout-all", {}, token);
  assert.equal((await post(srv, "/pull", { since: 0 }, token)).status, 401, "and revocable");
});

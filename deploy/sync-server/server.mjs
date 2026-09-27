// Bread of Life sync server — a small delta-sync backend for the Dexie/IndexedDB
// client. Standard local-first pattern: per-record last-write-wins keyed by
// (account, table, id), a monotonic per-account `seq` for cursor pulls, and
// tombstones for deletes. Journal, prayers and notes arrive end-to-end encrypted
// when the user turns encryption on (the payload is then `{__enc: "..."}`, which
// this server cannot read); everything else is stored as sent. Passwords are
// scrypt-hashed. Self-hostable: `docker compose up`.
//
// API (JSON; `Authorization: Bearer <token>` on everything except /health and the
// signup/login routes). Every addition since v0.4.0 is backward compatible: a
// v0.4.0 client sends and reads exactly what it did before.
//   GET  /health                             -> {ok, version, features[]}
//   POST /auth/signup {email,password}       -> {token}
//   POST /auth/login  {email,password}       -> {token}
//   POST /auth/refresh                       -> {token}            (fresh expiry)
//   POST /auth/logout-all                    -> {ok}               (revokes every token)
//   POST /auth/password {current,next}       -> {token}            (revokes every other token)
//   POST /account/delete {password}          -> {ok}               (deletes the account and all its data)
//   POST /pull {since, deviceId?, limit?}    -> {changes:[{table,id,updatedAt,deleted,data}], cursor, more}
//   POST /push {changes:[...], deviceId?}    -> {cursor, rejected:[{table,id,reason,current?}], adjusted?}
//
// Push rows are checked one at a time: a bad row is reported in `rejected` and the
// rest still apply. A row older than the server's copy is rejected as "stale"; when
// the client sent a deviceId (a v0.5+ client) the server's copy comes back as
// `current` so the client can adopt it, and a stamp the server clamped (more than
// five minutes ahead of its clock) comes back in `adjusted` so the client can store
// the same stamp. A pull with a deviceId skips rows that device wrote itself. `features` in /health is how clients discover all this.
import http from "node:http";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

const VERSION = "0.5.0";
// "readingLog": stores the reading-log table (clients hold it back from servers without it).
const FEATURES = ["rejected", "no-echo", "more", "refresh", "logout-all", "password", "delete-account", "clamp", "readingLog"];

const PORT = Number(process.env.PORT || 4000);
const DB_PATH = process.env.DB_PATH || "/app/data/sync.db";
const PRODUCTION = process.env.NODE_ENV === "production";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 8 * 1024 * 1024);
const MAX_RECORDS_PER_ACCOUNT = Number(process.env.MAX_RECORDS_PER_ACCOUNT || 250_000);
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_DAYS || 90) * 86_400_000;
const PAGE = 5000; // largest pull page (v0.4.0 clients assume a full page means "more")
const FUTURE_SLACK_MS = 5 * 60_000; // how far ahead of the server's clock a stamp may be
const SCRYPT_LOG_N = Number(process.env.SCRYPT_LOG_N || 17); // OWASP: N=2^17, r=8, p=1

// Tokens are signed with TOKEN_SECRET. A random fallback would sign everyone out on
// every restart (and the apps before v0.5 never told the user), so production must set it.
let TOKEN_SECRET = process.env.TOKEN_SECRET || "";
if (!TOKEN_SECRET) {
  if (PRODUCTION) {
    console.error("TOKEN_SECRET is not set. Set it to a long random string (openssl rand -hex 32) and keep it stable. Refusing to start.");
    process.exit(1);
  }
  console.warn("TOKEN_SECRET is not set: using a random one, so every token dies when this process stops.");
  TOKEN_SECRET = crypto.randomBytes(32).toString("hex");
} else if (TOKEN_SECRET.length < 32) {
  console.warn("TOKEN_SECRET is shorter than 32 characters; a longer one is harder to guess.");
}

/** The tables the app syncs. Anything else is refused. */
const TABLES = new Set([
  "highlights", "notes", "prayers", "journal", "progress",
  "settings", "plans", "devotions", "customPlans", "memory", "readingLog",
]);
/** Settings that describe one device and must never be stored (older apps sent them). */
const DEVICE_LOCAL_SETTINGS = ["misslerLibraryPath"];

/* ---------------------------------- storage ---------------------------------- */

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pwhash TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS records (
    account_id TEXT NOT NULL, tbl TEXT NOT NULL, id TEXT NOT NULL,
    updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    data TEXT, seq INTEGER NOT NULL,
    PRIMARY KEY (account_id, tbl, id)
  );
  CREATE INDEX IF NOT EXISTS records_seq ON records (account_id, seq);
  CREATE TABLE IF NOT EXISTS seqs (account_id TEXT PRIMARY KEY, seq INTEGER NOT NULL);
`);
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasColumn("accounts", "token_version")) db.exec("ALTER TABLE accounts ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
if (!hasColumn("records", "device_id")) db.exec("ALTER TABLE records ADD COLUMN device_id TEXT");

const q = {
  seq: db.prepare("SELECT seq FROM seqs WHERE account_id=?"),
  setSeq: db.prepare("INSERT INTO seqs (account_id, seq) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET seq=excluded.seq"),
  accountByEmail: db.prepare("SELECT * FROM accounts WHERE email=?"),
  accountById: db.prepare("SELECT * FROM accounts WHERE id=?"),
  insertAccount: db.prepare("INSERT INTO accounts (id,email,pwhash,created_at,token_version) VALUES (?,?,?,?,0)"),
  setHash: db.prepare("UPDATE accounts SET pwhash=? WHERE id=?"),
  bumpTokenVersion: db.prepare("UPDATE accounts SET token_version=token_version+1 WHERE id=?"),
  record: db.prepare("SELECT updated_at, deleted, data FROM records WHERE account_id=? AND tbl=? AND id=?"),
  count: db.prepare("SELECT COUNT(*) AS n FROM records WHERE account_id=?"),
  upsert: db.prepare(
    "INSERT INTO records (account_id,tbl,id,updated_at,deleted,data,seq,device_id) VALUES (?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(account_id,tbl,id) DO UPDATE SET updated_at=excluded.updated_at, deleted=excluded.deleted, " +
      "data=excluded.data, seq=excluded.seq, device_id=excluded.device_id",
  ),
  page: db.prepare(
    "SELECT tbl,id,updated_at,deleted,data,seq,device_id FROM records WHERE account_id=? AND seq>? ORDER BY seq ASC LIMIT ?",
  ),
};

function nextSeq(accountId) {
  const seq = (q.seq.get(accountId)?.seq ?? 0) + 1;
  q.setSeq.run(accountId, seq);
  return seq;
}

/** One-off repairs, safe to run on every start. */
function repair() {
  const now = Date.now();
  db.exec("BEGIN");
  try {
    // A stamp far in the future (a bad clock, or a malicious push before the clamp
    // existed) would win every later edit. Pull such rows back to now, as new changes.
    const future = db.prepare("SELECT account_id, tbl, id FROM records WHERE updated_at > ?").all(now + FUTURE_SLACK_MS);
    const fix = db.prepare("UPDATE records SET updated_at=?, seq=? WHERE account_id=? AND tbl=? AND id=?");
    for (const r of future) fix.run(now, nextSeq(r.account_id), r.account_id, r.tbl, r.id);
    // Device-local settings older apps uploaded. Removed without a tombstone, so
    // the devices that own them keep their local copies.
    for (const key of DEVICE_LOCAL_SETTINGS) db.prepare("DELETE FROM records WHERE tbl='settings' AND id=?").run(key);
    db.exec("COMMIT");
    if (future.length) console.log(`repaired ${future.length} future-dated record(s)`);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
repair();

/* ------------------------------ passwords + tokens ---------------------------- */

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT = { N: 2 ** SCRYPT_LOG_N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const LEGACY_SCRYPT = { N: 2 ** 14, r: 8, p: 1 }; // v0.4.0's crypto.scryptSync defaults

// scrypt at N=2^17 takes ~128 MB and a few hundred ms. Run at most two at once so
// a burst of logins cannot exhaust the container's memory.
let hashing = 0;
const hashQueue = [];
async function withHashSlot(fn) {
  if (hashing >= 2) await new Promise((r) => hashQueue.push(r));
  hashing++;
  try {
    return await fn();
  } finally {
    hashing--;
    hashQueue.shift()?.();
  }
}
const derive = (pw, salt, p) => withHashSlot(() => scryptAsync(pw, salt, 32, p));

async function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await derive(pw, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${hash.toString("hex")}`;
}
/** Parses both the current format and v0.4.0's "salt:hash". */
function parseHash(stored) {
  if (stored.startsWith("scrypt$")) {
    const [, N, r, p, salt, hash] = stored.split("$");
    return { salt, hash, params: { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem }, legacy: false };
  }
  const [salt, hash] = stored.split(":");
  return { salt, hash, params: LEGACY_SCRYPT, legacy: true };
}
async function verifyPw(pw, stored) {
  const { salt, hash, params, legacy } = parseHash(stored);
  const a = Buffer.from(hash, "hex");
  const b = await derive(pw, salt, params);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, needsRehash: ok && (legacy || params.N !== SCRYPT.N) };
}
// Checked against when the email is unknown, so a miss costs the same as a hit.
const DUMMY_HASH = await hashPw(crypto.randomBytes(16).toString("hex"));

const mac = (body) => crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
function sign(account) {
  const iat = Date.now();
  const body = Buffer.from(JSON.stringify({ a: account.id, v: account.token_version ?? 0, iat, exp: iat + TOKEN_TTL_MS })).toString("base64url");
  return `${body}.${mac(body)}`;
}
/** The account a token belongs to, or null if it is forged, expired or revoked. */
function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = mac(body);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (typeof claims?.a !== "string") return null;
  const account = q.accountById.get(claims.a);
  if (!account) return null; // deleted
  // v0.4.0 tokens carry neither a version nor an expiry. They stay valid until the
  // account first revokes its tokens (logout-all or a password change), so an
  // update to this server never silently signs out the older apps in the field.
  if (claims.v === undefined) return account.token_version === 0 ? account : null;
  if (claims.v !== account.token_version) return null;
  if (typeof claims.exp !== "number" || claims.exp < Date.now()) return null;
  return account;
}

/* ---------------------------------- helpers ---------------------------------- */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, "request too large"));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (c) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new HttpError(413, "request too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (failed) return;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try {
        const body = JSON.parse(text);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch {
        reject(new HttpError(400, "body must be a JSON object"));
      }
    });
    req.on("error", reject);
  });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const send = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json", ...CORS, ...(code === 413 ? { Connection: "close" } : {}) });
  res.end(JSON.stringify(obj));
};

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
function credentials(body) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (email.length > 254 || !EMAIL.test(email)) throw new HttpError(400, "enter a valid email address");
  if (password.length < 8 || password.length > 1024) throw new HttpError(400, "password must be 8 to 1024 characters");
  return { email, password };
}
async function checkPassword(account, password) {
  const { ok, needsRehash } = await verifyPw(password, account.pwhash);
  if (ok && needsRehash) q.setHash.run(await hashPw(password), account.id);
  return ok;
}
const validDeviceId = (d) => (typeof d === "string" && d.length > 0 && d.length <= 128 ? d : null);

/** Why a pushed row cannot be stored, or null if it is well formed. */
function invalidReason(c) {
  if (!c || typeof c !== "object") return "invalid";
  if (typeof c.table !== "string" || !TABLES.has(c.table)) return "table";
  if (typeof c.id !== "string" || c.id.length === 0 || c.id.length > 512) return "invalid";
  if (c.updatedAt != null && (typeof c.updatedAt !== "number" || !Number.isFinite(c.updatedAt) || c.updatedAt < 0)) return "invalid";
  if (!c.deleted && (c.data === null || typeof c.data !== "object" || Array.isArray(c.data))) return "invalid";
  if (c.table === "settings" && DEVICE_LOCAL_SETTINGS.includes(c.id)) return "device-local";
  return null;
}

/* ---------------------------------- routes ----------------------------------- */

async function signup(body) {
  const { email, password } = credentials(body);
  if (q.accountByEmail.get(email)) throw new HttpError(409, "email in use");
  const account = { id: crypto.randomUUID(), token_version: 0 };
  q.insertAccount.run(account.id, email, await hashPw(password), Date.now());
  return { token: sign(account) };
}

async function login(body) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const account = q.accountByEmail.get(email);
  // Always hash once, so a wrong email and a wrong password take the same time.
  const ok = account ? await checkPassword(account, password) : (await verifyPw(password, DUMMY_HASH), false);
  if (!ok) throw new HttpError(401, "invalid credentials");
  return { token: sign(q.accountById.get(account.id)) };
}

function pull(account, body) {
  const since = Math.max(0, Number(body.since) || 0);
  const limit = Math.min(PAGE, Math.max(1, Number(body.limit) || PAGE));
  const deviceId = validDeviceId(body.deviceId);
  const rows = q.page.all(account.id, since, limit + 1);
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const cursor = page.length ? page[page.length - 1].seq : since;
  const changes = [];
  for (const r of page) {
    if (deviceId && r.device_id === deviceId) continue; // its own write: it already has it
    changes.push({ table: r.tbl, id: r.id, updatedAt: r.updated_at, deleted: !!r.deleted, data: r.data ? JSON.parse(r.data) : null });
  }
  return { changes, cursor, more };
}

function push(account, body) {
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const deviceId = validDeviceId(body.deviceId);
  const rejected = [];
  const adjusted = [];
  const now = Date.now();
  let count = q.count.get(account.id).n;
  db.exec("BEGIN");
  try {
    for (const c of changes) {
      const reason = invalidReason(c);
      if (reason) {
        rejected.push({ table: typeof c?.table === "string" ? c.table : null, id: typeof c?.id === "string" ? c.id : null, reason });
        continue;
      }
      // A stamp too far ahead of our clock would beat every later edit forever.
      const updatedAt = Math.min(c.updatedAt || now, now + FUTURE_SLACK_MS);
      if (deviceId && updatedAt !== c.updatedAt) adjusted.push({ table: c.table, id: c.id, updatedAt });
      const existing = q.record.get(account.id, c.table, c.id);
      if (existing && existing.updated_at >= updatedAt) {
        const r = { table: c.table, id: c.id, reason: "stale" };
        if (deviceId) {
          r.current = {
            table: c.table, id: c.id, updatedAt: existing.updated_at, deleted: !!existing.deleted,
            data: existing.data ? JSON.parse(existing.data) : null,
          };
        }
        rejected.push(r);
        continue;
      }
      if (!existing) {
        if (count >= MAX_RECORDS_PER_ACCOUNT) {
          rejected.push({ table: c.table, id: c.id, reason: "quota" });
          continue;
        }
        count++;
      }
      q.upsert.run(account.id, c.table, c.id, updatedAt, c.deleted ? 1 : 0, c.deleted || c.data == null ? null : JSON.stringify(c.data), nextSeq(account.id), deviceId);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { cursor: q.seq.get(account.id)?.seq ?? 0, rejected, ...(deviceId ? { adjusted } : {}) };
}

async function changePassword(account, body) {
  if (!(await checkPassword(account, String(body.current ?? "")))) throw new HttpError(401, "current password is wrong");
  const next = String(body.next ?? "");
  if (next.length < 8 || next.length > 1024) throw new HttpError(400, "password must be 8 to 1024 characters");
  q.setHash.run(await hashPw(next), account.id);
  q.bumpTokenVersion.run(account.id);
  return { token: sign(q.accountById.get(account.id)) };
}

async function deleteAccount(account, body) {
  if (!(await checkPassword(account, String(body.password ?? "")))) throw new HttpError(401, "password is wrong");
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM records WHERE account_id=?").run(account.id);
    db.prepare("DELETE FROM seqs WHERE account_id=?").run(account.id);
    db.prepare("DELETE FROM accounts WHERE id=?").run(account.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = (req.url || "").split("?")[0];
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method === "GET" && url === "/health") return send(res, 200, { ok: true, version: VERSION, features: FEATURES });
    if (req.method !== "POST") return send(res, 404, { error: "not found" });
    const body = await readBody(req);

    if (url === "/auth/signup") return send(res, 200, await signup(body));
    if (url === "/auth/login") return send(res, 200, await login(body));

    const account = verifyToken((req.headers.authorization || "").replace(/^Bearer /, ""));
    if (!account) return send(res, 401, { error: "unauthorized" });

    switch (url) {
      case "/pull":
        return send(res, 200, pull(account, body));
      case "/push":
        return send(res, 200, push(account, body));
      case "/auth/refresh":
        return send(res, 200, { token: sign(account) });
      case "/auth/logout-all":
        q.bumpTokenVersion.run(account.id);
        return send(res, 200, { ok: true });
      case "/auth/password":
        return send(res, 200, await changePassword(account, body));
      case "/account/delete":
        return send(res, 200, await deleteAccount(account, body));
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    return send(res, 500, { error: "server error" });
  }
});

server.listen(PORT, () => console.log(`bread-of-life sync server ${VERSION} on :${PORT} (db ${DB_PATH})`));

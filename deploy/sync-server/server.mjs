// Bread of Life sync server — a small delta-sync backend for the Dexie/
// IndexedDB client. Standard local-first pattern: per-record last-write-wins
// keyed by (account, table, id), monotonic per-account `seq` for cursor pulls,
// tombstones for deletes. Data is stored server-side (E2E is deferred — see
// ROADMAP); passwords are scrypt-hashed. Self-hostable: `docker compose up`.
//
// API (all JSON; auth via `Authorization: Bearer <token>` except auth routes):
//   POST /auth/signup {email,password} -> {token}
//   POST /auth/login  {email,password} -> {token}
//   POST /pull {since:number}          -> {changes:[{table,id,updatedAt,deleted,data}], cursor:number}
//   POST /push {changes:[...]}         -> {cursor:number}
//   GET  /health                       -> {ok:true}
import http from "node:http";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const PORT = Number(process.env.PORT || 4000);
const DB_PATH = process.env.DB_PATH || "/app/data/sync.db";
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString("hex");

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

const scrypt = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${scrypt(pw, salt)}`;
}
function verifyPw(pw, stored) {
  const [salt, hash] = stored.split(":");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(scrypt(pw, salt), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sign(accountId) {
  const body = Buffer.from(JSON.stringify({ a: accountId })).toString("base64url");
  const mac = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verifyToken(token) {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expect = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()).a;
  } catch {
    return null;
  }
}
function nextSeq(accountId) {
  const row = db.prepare("SELECT seq FROM seqs WHERE account_id=?").get(accountId);
  const seq = (row?.seq ?? 0) + 1;
  db.prepare("INSERT INTO seqs (account_id, seq) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET seq=?").run(
    accountId,
    seq,
    seq,
  );
  return seq;
}

const readBody = (req) =>
  new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch {
        resolve({});
      }
    });
  });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const send = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url || "";
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method === "GET" && url === "/health") return send(res, 200, { ok: true });
    if (req.method !== "POST") return send(res, 404, { error: "not found" });
    const body = await readBody(req);

    if (url === "/auth/signup") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!email || password.length < 8) return send(res, 400, { error: "email + 8-char password required" });
      if (db.prepare("SELECT 1 FROM accounts WHERE email=?").get(email)) return send(res, 409, { error: "email in use" });
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO accounts (id,email,pwhash,created_at) VALUES (?,?,?,?)").run(id, email, hashPw(password), Date.now());
      return send(res, 200, { token: sign(id) });
    }
    if (url === "/auth/login") {
      const email = String(body.email || "").trim().toLowerCase();
      const acc = db.prepare("SELECT * FROM accounts WHERE email=?").get(email);
      if (!acc || !verifyPw(String(body.password || ""), acc.pwhash)) return send(res, 401, { error: "invalid credentials" });
      return send(res, 200, { token: sign(acc.id) });
    }

    // authed routes
    const accountId = verifyToken((req.headers.authorization || "").replace(/^Bearer /, ""));
    if (!accountId) return send(res, 401, { error: "unauthorized" });

    if (url === "/pull") {
      const since = Number(body.since || 0);
      const rows = db
        .prepare("SELECT tbl,id,updated_at,deleted,data,seq FROM records WHERE account_id=? AND seq>? ORDER BY seq ASC LIMIT 5000")
        .all(accountId, since);
      const cursor = rows.length ? rows[rows.length - 1].seq : since;
      const changes = rows.map((r) => ({ table: r.tbl, id: r.id, updatedAt: r.updated_at, deleted: !!r.deleted, data: r.data ? JSON.parse(r.data) : null }));
      return send(res, 200, { changes, cursor });
    }
    if (url === "/push") {
      const changes = Array.isArray(body.changes) ? body.changes : [];
      const get = db.prepare("SELECT updated_at FROM records WHERE account_id=? AND tbl=? AND id=?");
      const up = db.prepare(
        "INSERT INTO records (account_id,tbl,id,updated_at,deleted,data,seq) VALUES (?,?,?,?,?,?,?) " +
          "ON CONFLICT(account_id,tbl,id) DO UPDATE SET updated_at=excluded.updated_at, deleted=excluded.deleted, data=excluded.data, seq=excluded.seq",
      );
      db.exec("BEGIN");
      try {
        for (const c of changes) {
          if (!c || !c.table || !c.id) continue;
          const existing = get.get(accountId, c.table, c.id);
          // last-write-wins
          if (existing && existing.updated_at >= Number(c.updatedAt || 0)) continue;
          up.run(accountId, c.table, c.id, Number(c.updatedAt || Date.now()), c.deleted ? 1 : 0, c.data == null ? null : JSON.stringify(c.data), nextSeq(accountId));
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      const cursor = db.prepare("SELECT seq FROM seqs WHERE account_id=?").get(accountId)?.seq ?? 0;
      return send(res, 200, { cursor });
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => console.log(`bread-of-life sync server on :${PORT} (db ${DB_PATH})`));

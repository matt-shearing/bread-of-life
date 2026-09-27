/**
 * Start a throwaway sync server for the tests: the current deploy/sync-server/server.mjs,
 * or the v0.4.0 one (read from git), which is what production still runs until the next
 * deploy. Each gets its own temporary database.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
let legacyPath = null;

/** deploy/sync-server/server.mjs as released in v0.4.0. */
export function legacyServerPath() {
  if (!legacyPath) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bol-sync-legacy-"));
    legacyPath = path.join(dir, "server.mjs");
    fs.writeFileSync(legacyPath, execFileSync("git", ["show", "v0.4.0:deploy/sync-server/server.mjs"], { cwd: ROOT }));
  }
  return legacyPath;
}
export const currentServerPath = () => path.join(ROOT, "deploy/sync-server/server.mjs");

/**
 * Spawn a server; resolves once it is listening. `flavor` is "v0.4.0" or "current".
 * Pass `dir` to reuse another server's database (e.g. upgrade v0.4.0 → current).
 */
export async function startServer(flavor, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await spawnServer(flavor, opts);
    } catch (e) {
      if (attempt >= 4 || !String(e.message).includes("EADDRINUSE")) throw e;
    }
  }
}

/** A port nothing is listening on right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function spawnServer(flavor, { env = {}, dir } = {}) {
  dir ??= fs.mkdtempSync(path.join(os.tmpdir(), "bol-sync-"));
  const port = await freePort();
  const script = flavor === "v0.4.0" ? legacyServerPath() : currentServerPath();
  const proc = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(dir, "sync.db"),
      TOKEN_SECRET: "t".repeat(64),
      SCRYPT_LOG_N: "12", // fast hashing for tests (the server defaults to 2^17)
      NODE_NO_WARNINGS: "1",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  await new Promise((resolve, reject) => {
    proc.stdout.on("data", (d) => String(d).includes("sync server") && resolve());
    proc.on("exit", (code) => reject(new Error(`server exited (${code}): ${stderr}`)));
  });
  const url = `http://127.0.0.1:${port}`;
  const stop = () =>
    new Promise((r) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return r();
      proc.once("exit", r);
      proc.kill();
    });
  return { url, port, dir, flavor, proc, stop };
}

/** Every stored record, straight from the server's SQLite file. */
export async function serverRows(srv) {
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync(path.join(srv.dir, "sync.db"), { readOnly: true });
  try {
    return d.prepare("SELECT tbl, id, updated_at, deleted, data, seq FROM records ORDER BY seq").all()
      .map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
  } finally {
    d.close();
  }
}

/** POST to the server as a raw client (an older app, or someone misbehaving). */
export async function post(srv, route, body, token) {
  const res = await fetch(srv.url + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, data, text };
}

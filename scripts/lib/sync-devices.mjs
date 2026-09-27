/**
 * Loads the REAL client sync code (src/db/{index,sync,syncTracking,crypto,planMerge}.ts)
 * as several independent "devices" inside one Node process, for scripts/test-sync.mjs.
 *
 * Each device gets its own module instances (a `?dev=NAME` query is carried down the
 * import graph), its own fake-indexeddb, its own localStorage, and its own clock, which
 * can be skewed. Everything else is unchanged source; Node strips the TypeScript types.
 * Needs Node 23.6+.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import "fake-indexeddb/auto";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const STUBS = {
  "@tauri-apps/plugin-http": "data:text/javascript," + encodeURIComponent("export const fetch = (...a) => globalThis.fetch(...a);"),
};

function devOf(url) {
  const m = /[?&]dev=([\w-]+)/.exec(url ?? "");
  return m ? m[1] : null;
}
function withExt(path) {
  for (const p of [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`]) if (existsSync(p) && !p.endsWith("/")) return p;
  return path;
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: STUBS[specifier], shortCircuit: true };
    const dev = devOf(context.parentURL);
    let target = null;
    if (specifier.startsWith("@/")) target = withExt(SRC + specifier.slice(2));
    else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && context.parentURL.includes("/src/")) {
      target = withExt(fileURLToPath(new URL(specifier, context.parentURL.split("?")[0])));
    }
    if (target) return { url: pathToFileURL(target).href + (dev ? `?dev=${dev}` : ""), shortCircuit: true, format: "module-typescript" };
    return next(specifier, context);
  },
  load(url, context, next) {
    const r = next(url, context);
    const dev = devOf(url);
    if (!dev || !url.includes("/src/")) return r;
    const prefix = `const localStorage = globalThis.__bolDevices[${JSON.stringify(dev)}].localStorage; const Date = globalThis.__bolDevices[${JSON.stringify(dev)}].Date;\n`;
    return { ...r, source: prefix + String(r.source) };
  },
});

const RealDate = globalThis.Date;
globalThis.__bolDevices = {};

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    get length() {
      return m.size;
    },
  };
}

function skewedDate(skew) {
  return class SkewedDate extends RealDate {
    constructor(...a) {
      if (a.length) super(...a);
      else super(RealDate.now() + skew.ms);
    }
    static now() {
      return RealDate.now() + skew.ms;
    }
  };
}

let n = 0;
/**
 * A fresh device: { name, db, sync, crypto, repos, tracking, skew, localStorage, idb }.
 * Pass `restartOf: otherDevice` to get the same device after an app restart: same
 * IndexedDB and localStorage, fresh module state.
 */
export async function device(name = `d${n + 1}`, { skewMs = 0, restartOf = null } = {}) {
  const id = `${name}-${++n}`;
  const skew = restartOf?.skew ?? { ms: skewMs };
  const localStorage = restartOf?.localStorage ?? memoryStorage();
  const idb = restartOf?.idb ?? new IDBFactory();
  restartOf?.db.close();
  globalThis.__bolDevices[id] = { localStorage, Date: skewedDate(skew) };
  globalThis.__bolIndexedDB = { indexedDB: idb, IDBKeyRange };
  const q = `?dev=${id}`;
  const index = await import(pathToFileURL(SRC + "db/index.ts").href + q);
  const sync = await import(pathToFileURL(SRC + "db/sync.ts").href + q);
  const crypto = await import(pathToFileURL(SRC + "db/crypto.ts").href + q);
  const repos = await import(pathToFileURL(SRC + "db/repos.ts").href + q);
  const tracking = await import(pathToFileURL(SRC + "db/syncTracking.ts").href + q);
  delete globalThis.__bolIndexedDB;
  await index.db.open();
  sync.setAutoSync(false); // tests run rounds explicitly with syncNow()
  return { name, db: index.db, sync, crypto, repos, tracking, skew, localStorage, idb };
}

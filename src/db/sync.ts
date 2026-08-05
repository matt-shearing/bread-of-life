// Cross-device sync over the existing Dexie/IndexedDB store — works on every
// platform (IndexedDB is available in all our webviews, unlike OPFS). Standard
// local-first delta sync against deploy/sync-server: per-record last-write-wins.
//
// Design (keeps repos.ts + all read sites untouched):
//  - Dexie CRUD hooks stamp `updatedAt` on writes and, via onsuccess→setTimeout
//    (outside the txn), record the change key in the `outbox`. A module flag
//    suppresses this while applying REMOTE changes, so pulls never echo back.
//  - push: send outbox records (full row as `data`, or a tombstone) → clear.
//  - pull: fetch changes since a server cursor, merge LWW into Dexie.
import { db } from "./index";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  loadDataKey,
  saveDataKey,
  clearDataKey,
  generateDataKey,
  keyToPhrase,
  phraseToKey,
  encryptJSON,
  decryptJSON,
} from "./crypto";

/**
 * Personal content that is END-TO-END ENCRYPTED before it leaves the device when
 * E2E is on (a data key is present). Only the record payload is encrypted; the
 * server still keys on the cleartext (table, id, updatedAt) for last-write-wins.
 * Low-sensitivity sync metadata (progress/highlights/settings/plans/etc.) stays
 * clear so cross-device features remain simple.
 */
const ENCRYPTED_TABLES = new Set<string>(["journal", "prayers", "notes"]);

/** Set true when a pulled record was encrypted but we had no key to read it. */
export let e2eNeedsKey = false;

const SYNCED = [
  "highlights",
  "notes",
  "prayers",
  "journal",
  "progress",
  "settings",
  "plans",
  "devotions",
  "customPlans",
  "memory",
] as const;
type SyncedTable = (typeof SYNCED)[number];
const KEY_PATH: Record<SyncedTable, string> = {
  highlights: "id",
  notes: "id",
  prayers: "id",
  journal: "id",
  progress: "chapterOsis",
  settings: "key",
  plans: "planId",
  devotions: "id",
  customPlans: "id",
  memory: "id",
};
const isSynced = (t: string): t is SyncedTable => (SYNCED as readonly string[]).includes(t);

let applyingRemote = false;
let hooksInstalled = false;

export function installSyncHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  for (const t of SYNCED) {
    const table = db.table(t);
    const keyPath = KEY_PATH[t];
    table.hook("creating", function (pk, obj) {
      if (applyingRemote) return;
      (obj as Record<string, unknown>).updatedAt = Date.now();
      const id = String((obj as Record<string, unknown>)[keyPath] ?? pk);
      this.onsuccess = () => setTimeout(() => void markDirty(t, id, "upsert"), 0);
    });
    table.hook("updating", function (mods, pk) {
      if (applyingRemote) return;
      const id = String(pk);
      this.onsuccess = () => setTimeout(() => void markDirty(t, id, "upsert"), 0);
      return { ...mods, updatedAt: Date.now() };
    });
    table.hook("deleting", function (pk) {
      if (applyingRemote) return;
      const id = String(pk);
      this.onsuccess = () => setTimeout(() => void markDirty(t, id, "delete"), 0);
    });
  }
}

async function markDirty(table: string, id: string, op: "upsert" | "delete"): Promise<void> {
  await db.outbox.put({ key: `${table}:${id}`, table, id, op, at: Date.now() });
  scheduleSync();
}

/* ------------------------------- sync state ---------------------------------- */

export type SyncMode = "off" | "hosted" | "selfhost";
export interface SyncState {
  mode: SyncMode;
  url: string | null; // for selfhost
  token: string | null;
  email: string | null;
  cursor: number;
  deviceId: string;
  lastSyncAt: number | null;
  /** The account (email) we've already run the first-sign-in backfill for. */
  backfilledFor: string | null;
}

/** The project's hosted sync service (set at build time); hidden if unset. */
export const HOSTED_SYNC_URL: string | null = import.meta.env.VITE_BOL_SYNC_URL ?? null;

const DEFAULT_STATE: SyncState = {
  mode: "off",
  url: null,
  token: null,
  email: null,
  cursor: 0,
  deviceId: "",
  lastSyncAt: null,
  backfilledFor: null,
};

export async function getState(): Promise<SyncState> {
  const row = await db.syncState.get("main");
  const s = { ...DEFAULT_STATE, ...((row?.value as Partial<SyncState>) ?? {}) };
  if (!s.deviceId) {
    s.deviceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await db.syncState.put({ key: "main", value: s });
  }
  return s;
}

async function setState(patch: Partial<SyncState>): Promise<SyncState> {
  const cur = await getState();
  const next = { ...cur, ...patch };
  await db.syncState.put({ key: "main", value: next });
  return next;
}

export function resolveUrl(s: SyncState): string | null {
  if (s.mode === "hosted") return HOSTED_SYNC_URL;
  if (s.mode === "selfhost") return s.url?.trim().replace(/\/$/, "") || null;
  return null;
}

/* --------------------------------- transport --------------------------------- */

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const doFetch: typeof fetch = isTauri ? (tauriFetch as typeof fetch) : (globalThis.fetch?.bind(globalThis) as typeof fetch);

async function api<T = unknown>(
  base: string,
  path: string,
  body: unknown,
  token?: string | null,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      /* empty body */
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/* ----------------------------------- auth ------------------------------------ */

async function authRequest(
  route: "signup" | "login",
  mode: SyncMode,
  url: string | null,
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const base = resolveUrl({ ...DEFAULT_STATE, mode, url });
  if (!base) return { ok: false, error: "No sync server configured." };
  const res = await api<{ token?: string; error?: string }>(base, `/auth/${route}`, { email, password });
  if (res.ok && res.data?.token) {
    await setState({ mode, url: mode === "selfhost" ? url : null, token: res.data.token, email, cursor: 0 });
    // First sign-in on this account: enqueue ALL existing local rows so pre-sync
    // data actually uploads (the outbox otherwise only ever sees NEW edits).
    await backfillIfNeeded();
    void syncNow();
    return { ok: true };
  }
  return { ok: false, error: res.data?.error || (res.status === 0 ? "Can't reach the server." : "Sign-in failed.") };
}

export const signup = (mode: SyncMode, url: string | null, email: string, password: string) =>
  authRequest("signup", mode, url, email, password);
export const login = (mode: SyncMode, url: string | null, email: string, password: string) =>
  authRequest("login", mode, url, email, password);

export async function signOut(): Promise<void> {
  // Clear the account AND the backfill marker: signing out empties the outbox, so
  // any next sign-in (even the same account) must re-backfill to stay trustworthy.
  await setState({ mode: "off", token: null, email: null, cursor: 0, backfilledFor: null });
  await db.outbox.clear();
}

/* --------------------------- first-sign-in backfill -------------------------- */

export interface BackfillProgress {
  running: boolean;
  done: number;
  total: number;
}
let backfill: BackfillProgress = { running: false, done: 0, total: 0 };
const backfillListeners = new Set<(p: BackfillProgress) => void>();

function emitBackfill(p: BackfillProgress): void {
  backfill = p;
  for (const cb of backfillListeners) cb(p);
}

/** Observe backfill progress (fires immediately with the current state). */
export function subscribeBackfill(cb: (p: BackfillProgress) => void): () => void {
  backfillListeners.add(cb);
  cb(backfill);
  return () => {
    backfillListeners.delete(cb);
  };
}

/**
 * Enqueue every existing local synced-table row into the outbox so that data
 * created before the account existed (or before sync shipped) uploads on the
 * next push. Safe to run repeatedly — outbox entries dedup by `${table}:${id}`.
 */
export async function runBackfill(): Promise<number> {
  let total = 0;
  const counts: Partial<Record<SyncedTable, number>> = {};
  for (const t of SYNCED) {
    counts[t] = await db.table(t).count();
    total += counts[t]!;
  }
  emitBackfill({ running: true, done: 0, total });
  let done = 0;
  try {
    for (const t of SYNCED) {
      const keyPath = KEY_PATH[t];
      const rows = await db.table(t).toArray();
      const now = Date.now();
      const entries = rows.map((r) => {
        const id = String((r as Record<string, unknown>)[keyPath]);
        return { key: `${t}:${id}`, table: t as string, id, op: "upsert" as const, at: now };
      });
      if (entries.length) await db.outbox.bulkPut(entries);
      done += rows.length;
      emitBackfill({ running: true, done, total });
    }
  } finally {
    emitBackfill({ running: false, done, total });
  }
  return total;
}

/** Run the backfill once per account (idempotent), then schedule a push. */
async function backfillIfNeeded(): Promise<void> {
  const s = await getState();
  if (s.mode === "off" || !s.token || !s.email) return;
  if (s.backfilledFor === s.email) return;
  await runBackfill();
  await setState({ backfilledFor: s.email });
  scheduleSync();
}

/* ---------------------------------- engine ----------------------------------- */

export async function pushChanges(): Promise<void> {
  const s = await getState();
  const base = resolveUrl(s);
  if (!base || !s.token) return;
  const entries = await db.outbox.toArray();
  if (!entries.length) return;

  const key = loadDataKey();
  const changes: unknown[] = [];
  for (const e of entries) {
    if (e.op === "delete") {
      changes.push({ table: e.table, id: e.id, updatedAt: e.at, deleted: true, data: null });
      continue;
    }
    const rec = await db.table(e.table).get(e.id);
    if (!rec) {
      changes.push({ table: e.table, id: e.id, updatedAt: e.at, deleted: true, data: null });
    } else {
      // E2E: encrypt the payload of personal-content tables before it leaves the
      // device. `id`/`updatedAt` stay clear for server-side last-write-wins.
      const data =
        key && ENCRYPTED_TABLES.has(e.table) ? { __enc: await encryptJSON(key, rec) } : rec;
      changes.push({
        table: e.table,
        id: e.id,
        updatedAt: (rec as Record<string, unknown>).updatedAt ?? e.at,
        deleted: false,
        data,
      });
    }
  }

  const res = await api<{ cursor: number }>(base, "/push", { changes }, s.token);
  if (res.ok) {
    await db.outbox.bulkDelete(entries.map((e) => e.key)); // only what we sent
    await setState({ lastSyncAt: Date.now() });
  }
}

interface RemoteChange {
  table: string;
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

async function applyRemote(changes: RemoteChange[]): Promise<void> {
  // Resolve (decrypt) E2E payloads BEFORE opening the Dexie transaction — awaiting a
  // non-Dexie promise (crypto.subtle) inside a transaction breaks Dexie's zone and can
  // commit it early. Records we can't decrypt (no key / wrong key) are skipped and flag
  // e2eNeedsKey so the UI can prompt for the recovery phrase.
  const key = loadDataKey();
  type Resolved = { table: string; id: string; updatedAt: number; deleted: boolean; rec: Record<string, unknown> | null };
  const resolved: Resolved[] = [];
  for (const c of changes) {
    if (!isSynced(c.table)) continue;
    if (c.deleted) {
      resolved.push({ table: c.table, id: c.id, updatedAt: c.updatedAt, deleted: true, rec: null });
      continue;
    }
    if (!c.data) continue;
    let rec: Record<string, unknown> | null = c.data;
    const enc = (c.data as { __enc?: unknown }).__enc;
    if (typeof enc === "string") {
      if (!key) {
        e2eNeedsKey = true;
        continue; // encrypted, but this device has no key yet
      }
      try {
        rec = await decryptJSON<Record<string, unknown>>(key, enc);
      } catch {
        e2eNeedsKey = true;
        continue; // wrong key / tampered — leave it on the server, don't apply garbage
      }
    }
    resolved.push({ table: c.table, id: c.id, updatedAt: c.updatedAt, deleted: false, rec });
  }

  const tables = SYNCED.map((t) => db.table(t));
  applyingRemote = true;
  try {
    await db.transaction("rw", tables, async () => {
      for (const r of resolved) {
        const table = db.table(r.table);
        if (r.deleted) {
          await table.delete(r.id);
          continue;
        }
        if (!r.rec) continue;
        const local = (await table.get(r.id)) as Record<string, unknown> | undefined;
        const localUpdated = Number(local?.updatedAt ?? 0);
        if (!local || r.updatedAt >= localUpdated) {
          await table.put(r.rec);
        }
      }
    });
  } finally {
    applyingRemote = false;
  }
}

export async function pullChanges(): Promise<void> {
  const s = await getState();
  const base = resolveUrl(s);
  if (!base || !s.token) return;
  const res = await api<{ changes: RemoteChange[]; cursor: number }>(base, "/pull", { since: s.cursor }, s.token);
  if (!res.ok || !res.data) return;
  if (res.data.changes?.length) await applyRemote(res.data.changes);
  if (res.data.cursor != null && res.data.cursor !== s.cursor) {
    await setState({ cursor: res.data.cursor, lastSyncAt: Date.now() });
  }
}

let syncing = false;
let resyncQueued = false;
export async function syncNow(): Promise<void> {
  const s = await getState();
  if (s.mode === "off" || !s.token) return;
  if (syncing) {
    resyncQueued = true; // don't drop a request that arrived mid-sync
    return;
  }
  syncing = true;
  try {
    await pushChanges();
    await pullChanges();
  } finally {
    syncing = false;
  }
  if (resyncQueued) {
    resyncQueued = false;
    await syncNow();
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null;
function scheduleSync(): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), 1500);
}

let started = false;
export function startSync(): void {
  installSyncHooks();
  if (started) return;
  started = true;
  void syncNow();
  setInterval(() => void syncNow(), 60_000);
  if (typeof window !== "undefined") window.addEventListener("online", () => void syncNow());
}

export interface SyncStatus {
  mode: SyncMode;
  email: string | null;
  lastSyncAt: number | null;
  pending: number;
}
export async function getSyncStatus(): Promise<SyncStatus> {
  const s = await getState();
  const pending = await db.outbox.count();
  return { mode: s.mode, email: s.email, lastSyncAt: s.lastSyncAt, pending };
}

/* ------------------------------ E2E encryption controls ---------------------- */

export function getE2EStatus(): { enabled: boolean; needsKey: boolean } {
  return { enabled: loadDataKey() !== null, needsKey: e2eNeedsKey };
}

/** Re-enqueue every row of the encrypted tables so they re-upload in their new form. */
async function reencryptedTablesToOutbox(): Promise<void> {
  for (const t of SYNCED) {
    if (!ENCRYPTED_TABLES.has(t)) continue;
    const keyPath = KEY_PATH[t];
    const rows = await db.table(t).toArray();
    const now = Date.now();
    const entries = rows.map((r) => {
      const id = String((r as Record<string, unknown>)[keyPath]);
      return { key: `${t}:${id}`, table: t as string, id, op: "upsert" as const, at: now };
    });
    if (entries.length) await db.outbox.bulkPut(entries);
  }
}

/**
 * Turn on E2E for this account: generate a data key, keep it device-local, and
 * re-push all existing personal content encrypted. Returns the 24-word recovery
 * phrase to show ONCE (the only way to restore on another device).
 */
export async function enableE2E(): Promise<string> {
  const key = generateDataKey();
  saveDataKey(key);
  e2eNeedsKey = false;
  await reencryptedTablesToOutbox();
  void syncNow();
  return keyToPhrase(key);
}

/**
 * Restore E2E on a device from the recovery phrase, then re-pull everything so the
 * previously-unreadable encrypted records decrypt. Returns false if the phrase is invalid.
 */
export async function restoreE2E(phrase: string): Promise<boolean> {
  const key = await phraseToKey(phrase);
  if (!key) return false;
  saveDataKey(key);
  e2eNeedsKey = false;
  await setState({ cursor: 0 }); // force a full re-pull so encrypted rows decrypt now
  await syncNow();
  return true;
}

/** Show the current device's recovery phrase again (E2E must be on). */
export async function getRecoveryPhrase(): Promise<string | null> {
  const key = loadDataKey();
  return key ? keyToPhrase(key) : null;
}

/** Turn off E2E on THIS device (local plaintext is untouched; server keeps ciphertext). */
export function disableE2E(): void {
  clearDataKey();
  e2eNeedsKey = false;
}

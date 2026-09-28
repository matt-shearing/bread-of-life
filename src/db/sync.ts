// Cross-device sync over the existing Dexie/IndexedDB store — works on every
// platform (IndexedDB is available in all our webviews, unlike OPFS). Standard
// local-first delta sync against deploy/sync-server: per-record last-write-wins,
// except plan progress, which merges per day (src/db/planMerge.ts).
//
// Design (keeps repos.ts + all read sites untouched):
//  - A Dexie middleware (src/db/syncTracking.ts) stamps `updatedAt` monotonically on
//    every write to a synced table and queues the key in `outbox`, inside the write's
//    own transaction. Pulled rows are applied in an `untracked()` transaction, so they
//    are never queued back.
//  - push: send queued rows (the full row as `data`, encrypted for the personal tables
//    when E2E is on, or a tombstone) in bounded chunks. An entry is cleared only if it
//    is unchanged since it was sent AND the server is known to hold it: a v0.5 server
//    says which rows it rejected; with a v0.4.0 server the entry waits until a pull
//    shows the server's copy (see `confirmsSent` and `checkUnconfirmed`).
//  - pull: fetch changes since a server cursor, page by page until caught up, and merge
//    them into Dexie.
//  - The server's capabilities come from GET /health, so this client works against
//    the v0.4.0 server (no features) and uses the v0.5 additions when present.
import { db, type HeldChange, type OutboxEntry, type PlanProgress } from "./index";
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
  switchDataKeyAccount,
} from "./crypto";
import {
  ALWAYS_ENCRYPTED_TABLES,
  E2E_CHECK_KEY,
  ENCRYPTED_TABLES,
  KEY_PATH,
  SYNCED_TABLES,
  TABLE_FEATURES,
  syncsRow,
  type SyncedTable,
} from "./syncSchema";
import { nextOutboxAt, nextStamp, onQueued, untracked } from "./syncTracking";
import { mergePlans, samePlanProgress } from "./planMerge";
import { normaliseDevotionId } from "@/lib/devotionDone";

/* ------------------------------- sync state ---------------------------------- */

export type SyncMode = "off" | "hosted" | "selfhost";
export interface SyncState {
  mode: SyncMode;
  url: string | null; // for selfhost
  token: string | null;
  email: string | null;
  cursor: number;
  /** Identifies this install to a v0.5 server, which then skips echoing its own writes. */
  deviceId: string;
  lastSyncAt: number | null;
  /** The account (see `accountKey`) we've already run the first-sign-in backfill for. */
  backfilledFor: string | null;
  /** The last account this device signed in to; kept after sign-out (see `authRequest`). */
  lastAccount: string | null;
  /** The server refused the token (expired, revoked, account deleted): sign in again. */
  authError: boolean;
  /** Signed in to a different account while holding another account's data: waiting for the user's choice. */
  pendingAccountChoice: boolean;
  /** This device's key can't read the account's encryption check: the phrase belongs to another key. */
  keyMismatch: boolean;
  /**
   * Gated table (see TABLE_FEATURES) → the account whose server has been sent all of it.
   * Absent while the server lacks the table: its changes are dropped from the outbox then,
   * and the whole table is queued once the server gains it.
   */
  gatedSent: Record<string, string>;
}

/** The project's hosted sync service (set at build time); hidden if unset. */
export const HOSTED_SYNC_URL: string | null = import.meta.env?.VITE_BOL_SYNC_URL ?? null;

const DEFAULT_STATE: SyncState = {
  mode: "off",
  url: null,
  token: null,
  email: null,
  cursor: 0,
  deviceId: "",
  lastSyncAt: null,
  backfilledFor: null,
  lastAccount: null,
  authError: false,
  pendingAccountChoice: false,
  keyMismatch: false,
  gatedSent: {},
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
  const next = { ...(await getState()), ...patch };
  await db.syncState.put({ key: "main", value: next });
  return next;
}

export function resolveUrl(s: Pick<SyncState, "mode" | "url">): string | null {
  if (s.mode === "hosted") return HOSTED_SYNC_URL;
  if (s.mode === "selfhost") return s.url?.trim().replace(/\/$/, "") || null;
  return null;
}

/** "mode|server|email": one sync account. */
function accountKey(mode: SyncMode, url: string | null, email: string): string {
  return `${mode}|${resolveUrl({ mode, url }) ?? ""}|${email.trim().toLowerCase()}`;
}

/**
 * True for a self-hosted address that would send the password and every synced row
 * unencrypted: plain http:// to anything but this machine or the local network.
 */
export function isInsecureSyncUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (!u.startsWith("http://")) return false;
  const host = u.slice(7).split(/[/:]/)[0];
  return !(host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".local"));
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

/**
 * What the server supports, from GET /health. The v0.4.0 server answers `{ok:true}`
 * with no feature list, and this client then uses only what v0.4.0 offered.
 */
export interface ServerFeatures {
  version: string | null;
  features: ReadonlySet<string>;
  /** False when /health could not be read (offline), as opposed to an old server. */
  reachable: boolean;
}
const NO_FEATURES: ServerFeatures = { version: null, features: new Set(), reachable: false };
const featureCache = new Map<string, { at: number; value: ServerFeatures }>();

export async function serverFeatures(base: string): Promise<ServerFeatures> {
  const hit = featureCache.get(base);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  try {
    const res = await doFetch(`${base}/health`, { method: "GET" });
    if (!res.ok) return NO_FEATURES;
    const body = (await res.json()) as { version?: unknown; features?: unknown };
    const value: ServerFeatures = {
      reachable: true,
      version: typeof body.version === "string" ? body.version : null,
      features: new Set(Array.isArray(body.features) ? body.features.filter((f): f is string => typeof f === "string") : []),
    };
    featureCache.set(base, { at: Date.now(), value });
    return value;
  } catch {
    return NO_FEATURES; // not cached: try again next round
  }
}

/* ----------------------------------- auth ------------------------------------ */

async function hasLocalData(): Promise<boolean> {
  for (const t of SYNCED_TABLES) {
    if (t === "settings" || t === "apiKeys") continue; // preferences and keys exist on every device
    if ((await db.table(t).count()) > 0) return true;
  }
  return false;
}

export type AuthResult = { ok: true; needsAccountChoice: boolean } | { ok: false; error: string };

async function authRequest(
  route: "signup" | "login",
  mode: SyncMode,
  url: string | null,
  email: string,
  password: string,
): Promise<AuthResult> {
  const base = resolveUrl({ mode, url });
  if (!base) return { ok: false, error: "No sync server configured." };
  const res = await api<{ token?: string; error?: string }>(base, `/auth/${route}`, { email, password });
  if (!res.ok || !res.data?.token) {
    const error =
      res.status === 0
        ? "Can't reach the server."
        : res.status === 401
          ? "That email and password don't match an account."
          : res.status === 409
            ? "There is already an account with that email. Log in instead."
            : res.data?.error || "Sign-in failed.";
    return { ok: false, error };
  }

  const s = await getState();
  const account = accountKey(mode, url, email);
  const currentAccount = s.email ? accountKey(s.mode, s.url, s.email) : null;
  const previous = s.lastAccount ?? currentAccount; // signed in before v0.5 recorded lastAccount
  const switching = previous !== null && previous !== account;
  // Data on this device may belong to the previous account. Don't upload it into this
  // one until the user says so.
  const needsAccountChoice = switching && (await hasLocalData());
  if (switching) switchDataKeyAccount(previous, account);
  await setState({
    mode,
    url: mode === "selfhost" ? url : null,
    token: res.data.token,
    email,
    // Signing in again after the token expired keeps the cursor; anything else re-pulls.
    cursor: currentAccount === account ? s.cursor : 0,
    lastAccount: account,
    authError: false,
    pendingAccountChoice: needsAccountChoice,
    keyMismatch: switching ? false : s.keyMismatch,
    ...(switching ? { backfilledFor: null } : {}),
  });
  if (switching) {
    await db.outbox.clear(); // the previous account's queue
    await db.syncHeld.clear();
    // The previous account's encryption marker; this account's arrives with its first pull.
    await db.transaction("rw", db.settings, async (tx) => {
      untracked(tx);
      await db.settings.delete(E2E_CHECK_KEY);
    });
  }
  if (!needsAccountChoice) {
    // First sign-in on this account: enqueue ALL existing local rows so pre-sync data
    // actually uploads (the outbox otherwise only ever sees NEW edits).
    await backfillIfNeeded();
    void syncNow();
  }
  return { ok: true, needsAccountChoice };
}

export const signup = (mode: SyncMode, url: string | null, email: string, password: string) =>
  authRequest("signup", mode, url, email, password);
export const login = (mode: SyncMode, url: string | null, email: string, password: string) =>
  authRequest("login", mode, url, email, password);

/**
 * The user's answer after signing in to a different account on a device holding data:
 * `upload` sends this device's library to the new account; `keep-local` leaves it on
 * this device only (later edits to it will sync).
 */
export async function resolveAccountChoice(choice: "upload" | "keep-local"): Promise<void> {
  const s = await setState({ pendingAccountChoice: false });
  if (s.mode === "off" || !s.email) return;
  if (choice === "upload") await backfillIfNeeded();
  else await setState({ backfilledFor: accountKey(s.mode, s.url, s.email) });
  void syncNow();
}

export async function signOut(): Promise<void> {
  // Clear the account AND the backfill marker: signing out empties the outbox, so
  // any next sign-in (even the same account) must re-backfill to stay trustworthy.
  // `lastAccount` stays, so signing in to a different account can be noticed.
  const s = await getState();
  await setState({
    lastAccount: s.lastAccount ?? (s.email ? accountKey(s.mode, s.url, s.email) : null),
    mode: "off",
    token: null,
    email: null,
    cursor: 0,
    backfilledFor: null,
    authError: false,
    pendingAccountChoice: false,
    keyMismatch: false,
  });
  await db.outbox.clear();
  await db.syncHeld.clear();
}

/** Decoded token claims (the server signs them; we only read the timestamps). */
function tokenClaims(token: string): { iat?: number; exp?: number } {
  try {
    const b64 = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=")));
  } catch {
    return {};
  }
}

/** Swap a token without an expiry, or one older than a week, for a fresh one. */
async function refreshTokenIfDue(base: string, s: SyncState, f: ServerFeatures): Promise<SyncState> {
  if (!f.features.has("refresh") || !s.token) return s;
  const { iat, exp } = tokenClaims(s.token);
  if (exp && iat && Date.now() - iat < 7 * 86_400_000) return s;
  const res = await api<{ token?: string }>(base, "/auth/refresh", {}, s.token);
  return res.ok && res.data?.token ? setState({ token: res.data.token }) : s;
}

/** Account actions a v0.5 server offers; the UI shows only what the server supports. */
export async function accountFeatures(): Promise<{ logoutAll: boolean; changePassword: boolean; deleteAccount: boolean }> {
  const s = await getState();
  const base = resolveUrl(s);
  const f = base && s.token ? (await serverFeatures(base)).features : new Set<string>();
  return { logoutAll: f.has("logout-all"), changePassword: f.has("password"), deleteAccount: f.has("delete-account") };
}

async function accountCall(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: { token?: string; error?: string } | null }> {
  const s = await getState();
  const base = resolveUrl(s);
  if (!base || !s.token) return { ok: false, status: 0, data: { error: "Not signed in." } };
  return api(base, path, body, s.token);
}

function accountError(res: { status: number; data: { error?: string } | null }, fallback: string): string {
  if (res.status === 0) return "Can't reach the server.";
  if (res.status === 401) return "That password is wrong.";
  return res.data?.error || fallback;
}

/** Sign out on every device (revokes every token), then here. */
export async function signOutEverywhere(): Promise<{ ok: boolean; error?: string }> {
  const res = await accountCall("/auth/logout-all", {});
  if (!res.ok) return { ok: false, error: accountError(res, "Couldn't sign out other devices.") };
  await signOut();
  return { ok: true };
}

/** Change the account password. Other devices are signed out; this one stays signed in. */
export async function changePassword(current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  const res = await accountCall("/auth/password", { current, next });
  if (!res.ok || !res.data?.token) return { ok: false, error: accountError(res, "Couldn't change the password.") };
  await setState({ token: res.data.token, authError: false });
  return { ok: true };
}

/**
 * Delete the account and everything stored on the server. The data on this device is
 * untouched, and the device is signed out.
 */
export async function deleteAccount(password: string): Promise<{ ok: boolean; error?: string }> {
  const res = await accountCall("/account/delete", { password });
  if (!res.ok) return { ok: false, error: accountError(res, "Couldn't delete the account.") };
  await signOut();
  await setState({ lastAccount: null });
  return { ok: true };
}

/* ------------------------- enqueueing whole tables ---------------------------- */

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
 * Queue every row of `tables` for upload. With `bump`, each row's stamp also moves on by
 * 1 ms first, so the server takes the new upload over its identical-stamped copy (turning
 * on encryption re-uploads rows the server already holds in the clear). Rows keep their
 * own stamps otherwise: a restored or pre-sync row must not beat a newer server copy.
 * Safe to run repeatedly — outbox entries dedup by `${table}:${id}`.
 */
export async function enqueueAll(
  tables: readonly SyncedTable[] = SYNCED_TABLES,
  { bump = false, progress = false }: { bump?: boolean; progress?: boolean } = {},
): Promise<number> {
  let total = 0;
  if (progress) {
    for (const t of tables) total += await db.table(t).count();
    emitBackfill({ running: true, done: 0, total });
  }
  let done = 0;
  try {
    for (const t of tables) {
      const keyPath = KEY_PATH[t];
      await db.transaction("rw", [db.table(t), db.outbox], async (tx) => {
        untracked(tx);
        const rows = (await db.table(t).toArray()) as Record<string, unknown>[];
        const entries: OutboxEntry[] = [];
        for (const r of rows) {
          const id = String(r[keyPath]);
          if (!syncsRow(t, id)) continue;
          entries.push({ key: `${t}:${id}`, table: t, id, op: "upsert", at: nextOutboxAt() });
        }
        if (bump) await db.table(t).bulkPut(rows.filter((r) => r.updatedAt != null).map((r) => ({ ...r, updatedAt: Number(r.updatedAt) + 1 })));
        if (entries.length) await db.outbox.bulkPut(entries);
        done += rows.length;
      });
      if (progress) emitBackfill({ running: true, done, total });
    }
  } finally {
    if (progress) emitBackfill({ running: false, done, total });
  }
  return done;
}

/** Queue every synced row (the first-sign-in backfill). */
export const runBackfill = (): Promise<number> => enqueueAll(SYNCED_TABLES, { progress: true });

/** Run the backfill once per account (idempotent), then schedule a push. */
async function backfillIfNeeded(): Promise<void> {
  const s = await getState();
  if (s.mode === "off" || !s.token || !s.email) return;
  const account = accountKey(s.mode, s.url, s.email);
  if (s.backfilledFor === account || s.backfilledFor === s.email) return;
  await runBackfill();
  await setState({ backfilledFor: account });
  scheduleSync();
}

/* ------------------------------------ push ------------------------------------ */

export interface RemoteChange {
  table: string;
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

type Outcome = "ok" | "auth" | "offline";
interface Outgoing {
  entry: OutboxEntry;
  change: RemoteChange;
  bytes: number;
}

/** Push limits: well under Caddy's 8 MB body cap and quick to retry. */
const CHUNK_ROWS = 250;
const CHUNK_BYTES = 1_000_000;
/** Unconfirmed pushes (v0.4.0 server) before an entry is parked. */
const MAX_TRIES = 4;

/** True when this account encrypts: this device has the key, or it has seen the account's check row or ciphertext. */
async function accountEncrypted(key: Uint8Array | null): Promise<boolean> {
  if (key) return true;
  return !!(await db.settings.get(E2E_CHECK_KEY)) || (await db.syncHeld.count()) > 0;
}

/**
 * The last line of defence for secrets: throws if any change for an always-encrypted
 * table (the user's API keys) carries anything but ciphertext. Called on every push.
 */
export function assertNoPlaintextSecrets(changes: readonly RemoteChange[]): void {
  for (const c of changes) {
    if (!ALWAYS_ENCRYPTED_TABLES.has(c.table) || c.deleted) continue;
    const d = c.data as Record<string, unknown> | null;
    if (!d || typeof d.__enc !== "string" || Object.keys(d).length !== 1) {
      throw new Error(`sync: refusing to upload ${c.table}:${c.id} unencrypted`);
    }
  }
}

async function buildOutgoing(entries: OutboxEntry[], keyMismatch = false): Promise<{ out: Outgoing[]; drop: OutboxEntry[] }> {
  const key = loadDataKey();
  const encrypted = await accountEncrypted(key);
  const out: Outgoing[] = [];
  const drop: OutboxEntry[] = [];
  const byTable = new Map<string, OutboxEntry[]>();
  for (const e of entries) {
    if (e.stuck) continue;
    if (!syncsRow(e.table, e.id)) {
      drop.push(e); // a device-local setting queued by an older version
      continue;
    }
    // The account encrypts but this device has no key: hold personal content back
    // rather than upload it readable. It goes once the recovery phrase is entered.
    if (ENCRYPTED_TABLES.has(e.table) && !key && encrypted) continue;
    // Secrets go only encrypted, and only with the key the account's other devices hold.
    if (ALWAYS_ENCRYPTED_TABLES.has(e.table) && e.op !== "delete" && (!key || keyMismatch)) continue;
    byTable.set(e.table, [...(byTable.get(e.table) ?? []), e]);
  }
  for (const [table, list] of byTable) {
    const rows = (await db.table(table).bulkGet(list.map((e) => e.id))) as (Record<string, unknown> | undefined)[];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      let change: RemoteChange;
      if (e.op === "delete") {
        change = { table, id: e.id, updatedAt: e.stamp ?? e.at, deleted: true, data: null };
      } else {
        const rec = rows[i];
        // Queued as an upsert but gone: a pulled tombstone removed it. The delete is
        // already on the server; pushing our own would spread it with a new stamp.
        if (!rec) {
          drop.push(e);
          continue;
        }
        const data = key && ENCRYPTED_TABLES.has(table) ? { __enc: await encryptJSON(key, rec) } : rec;
        // A row from before sync stamped anything is older than any stamped copy.
        change = { table, id: e.id, updatedAt: Number(rec.updatedAt ?? 1), deleted: false, data };
      }
      out.push({ entry: e, change, bytes: JSON.stringify(change).length });
    }
  }
  assertNoPlaintextSecrets(out.map((o) => o.change));
  return { out, drop };
}

type Settle = { entry: OutboxEntry; action: "delete" } | { entry: OutboxEntry; action: "sent"; updatedAt: number } | { entry: OutboxEntry; action: "fail" };

/** Apply push results to outbox entries that are still exactly as they were sent. */
async function settle(items: Settle[]): Promise<void> {
  if (!items.length) return;
  await db.transaction("rw", db.outbox, async () => {
    const current = await db.outbox.bulkGet(items.map((it) => it.entry.key));
    const deletes: string[] = [];
    const puts: OutboxEntry[] = [];
    items.forEach((it, i) => {
      const cur = current[i];
      if (!cur || cur.at !== it.entry.at) return; // edited meanwhile: keep the new change
      if (it.action === "delete") deletes.push(cur.key);
      else if (it.action === "sent") puts.push({ ...cur, sent: { at: cur.at, updatedAt: it.updatedAt } });
      else {
        const tries = (cur.tries ?? 0) + 1;
        puts.push({ ...cur, tries, stuck: tries >= MAX_TRIES });
      }
    });
    if (deletes.length) await db.outbox.bulkDelete(deletes);
    if (puts.length) await db.outbox.bulkPut(puts);
  });
}

function chunk(items: Outgoing[]): Outgoing[][] {
  const out: Outgoing[][] = [];
  let cur: Outgoing[] = [];
  let bytes = 0;
  for (const it of items) {
    if (cur.length && (cur.length >= CHUNK_ROWS || bytes + it.bytes > CHUNK_BYTES)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(it);
    bytes += it.bytes;
  }
  if (cur.length) out.push(cur);
  return out;
}

interface PushResponse {
  cursor?: number;
  rejected?: { table: string | null; id: string | null; reason: string; current?: RemoteChange }[];
  /** Stamps the server clamped (this device's clock is ahead of the server's). */
  adjusted?: { table: string; id: string; updatedAt: number }[];
}

/**
 * Store the server's clamped stamp on our own row, so a later edit from a device with a
 * correct clock (stamped after the server's copy) also wins here.
 */
async function adoptStamps(items: Outgoing[], adjusted: NonNullable<PushResponse["adjusted"]>): Promise<void> {
  const sent = new Map(items.map((i) => [i.entry.key, i]));
  for (const a of adjusted) {
    const it = sent.get(`${a.table}:${a.id}`);
    if (!it || it.change.deleted) continue;
    await db.transaction("rw", [db.table(a.table), db.outbox], async (tx) => {
      untracked(tx);
      const cur = await db.outbox.get(it.entry.key);
      if (cur && cur.at !== it.entry.at) return; // edited since: its next push decides
      const row = (await db.table(a.table).get(a.id)) as Record<string, unknown> | undefined;
      if (row && Number(row.updatedAt) === it.change.updatedAt) await db.table(a.table).put({ ...row, updatedAt: a.updatedAt });
    });
  }
}

async function pushChunk(base: string, s: SyncState, f: ServerFeatures, items: Outgoing[]): Promise<Outcome> {
  const reportsRejects = f.features.has("rejected");
  const res = await api<PushResponse>(
    base,
    "/push",
    { changes: items.map((i) => i.change), ...(reportsRejects ? { deviceId: s.deviceId } : {}) },
    s.token,
  );
  if (res.status === 401) return "auth";
  if (res.ok) {
    if (reportsRejects && Array.isArray(res.data?.rejected)) {
      const rejected = new Map(res.data!.rejected.map((r) => [`${r.table}:${r.id}`, r]));
      // The server's newer copies win (last write wins); adopt them.
      const current = res.data!.rejected.flatMap((r) => (r.reason === "stale" && r.current ? [r.current] : []));
      if (current.length) await applyRemote(current);
      if (Array.isArray(res.data!.adjusted) && res.data!.adjusted.length) await adoptStamps(items, res.data!.adjusted);
      await settle(
        items.map(({ entry }) => {
          const r = rejected.get(entry.key);
          if (r && r.reason === "quota") return { entry, action: "fail" as const };
          if (r && r.reason !== "stale") console.warn(`sync: server refused ${entry.key} (${r.reason})`);
          return { entry, action: "delete" as const };
        }),
      );
    } else {
      // A v0.4.0 server answers 200 even when it ignored a row as older than its copy.
      await settle(items.map(({ entry, change }) => ({ entry, action: "sent" as const, updatedAt: change.updatedAt })));
    }
    return "ok";
  }
  // A body the server or its proxy won't take (too large), or a row that makes the v0.4.0
  // server fail the whole batch: split until the bad row is on its own, and park it.
  if (res.status === 413 || res.status === 400 || res.status === 500) {
    if (items.length > 1) {
      const mid = Math.ceil(items.length / 2);
      const a = await pushChunk(base, s, f, items.slice(0, mid));
      return a === "ok" ? pushChunk(base, s, f, items.slice(mid)) : a;
    }
    // One row failed. Is the server up at all? An empty push must succeed.
    const probe = await api(base, "/push", { changes: [] }, s.token);
    if (!probe.ok) return probe.status === 401 ? "auth" : "offline";
    console.warn(`sync: server refused ${items[0].entry.key} (HTTP ${res.status})`);
    await settle([{ entry: items[0].entry, action: "fail" }]);
    return "ok";
  }
  return "offline"; // unreachable, 429, 502–504: try again next round
}

export async function pushChanges(): Promise<Outcome> {
  const s = await getState();
  const base = resolveUrl(s);
  if (!base || !s.token) return "ok";
  const f = await serverFeatures(base);
  return push(base, s, f);
}

/**
 * Tables the server may not store yet (TABLE_FEATURES). Without the feature, their queued
 * changes are dropped: a v0.4.0 server fails a whole push over one, and they would park as
 * "stuck" and worry the user. The rows stay here, and the first push to a server that has
 * the feature queues the whole table.
 */
async function gateTables(s: SyncState, f: ServerFeatures): Promise<SyncState> {
  const account = accountKey(s.mode, s.url, s.email ?? "");
  const sent = { ...(s.gatedSent ?? {}) };
  let changed = false;
  for (const [table, feature] of Object.entries(TABLE_FEATURES) as [SyncedTable, string][]) {
    if (f.features.has(feature)) {
      if (sent[table] === account) continue;
      await enqueueAll([table]);
      sent[table] = account;
      changed = true;
    } else {
      await db.outbox.where("key").startsWith(`${table}:`).delete();
      if (table in sent) {
        delete sent[table];
        changed = true;
      }
    }
  }
  return changed ? setState({ gatedSent: sent }) : s;
}

async function push(base: string, s: SyncState, f: ServerFeatures): Promise<Outcome> {
  s = await gateTables(s, f);
  const entries = await db.outbox.toArray();
  if (!entries.length) return "ok";
  const { out, drop } = await buildOutgoing(entries, s.keyMismatch);
  await settle(drop.map((entry) => ({ entry, action: "delete" as const })));
  for (const items of chunk(out)) {
    const r = await pushChunk(base, s, f, items);
    if (r !== "ok") return r;
  }
  return "ok";
}

/* ------------------------------------ pull ------------------------------------ */

/** Set when applying a pull queued a merged row for upload (see runRound). */
let mergeQueued = false;

type Resolved =
  | { table: SyncedTable; id: string; key: string; updatedAt: number; kind: "delete" }
  | { table: SyncedTable; id: string; key: string; updatedAt: number; kind: "put"; rec: Record<string, unknown> }
  | { table: SyncedTable; id: string; key: string; updatedAt: number; kind: "hold"; data: Record<string, unknown> };

const listeners = { status: new Set<() => void>() };
/** Observe E2E status changes (held rows, key mismatch) — e.g. to refresh a banner. */
export function onE2EStatusChange(cb: () => void): () => void {
  listeners.status.add(cb);
  return () => {
    listeners.status.delete(cb);
  };
}
const emitStatus = () => listeners.status.forEach((cb) => cb());

/**
 * Merge pulled changes into Dexie. Last write wins per row (deletes too), except plan
 * progress, which merges per day. Encrypted rows this device can't read are held for
 * later; plaintext for an encrypted table is refused once the account encrypts (a
 * server must not be able to plant readable — or scripted — journal entries).
 */
export async function applyRemote(changes: RemoteChange[]): Promise<void> {
  // Resolve (decrypt) E2E payloads BEFORE opening the Dexie transaction — awaiting a
  // non-Dexie promise (crypto.subtle) inside a transaction breaks Dexie's zone and can
  // commit it early.
  const key = loadDataKey();
  const encrypted = await accountEncrypted(key);
  const resolved: Resolved[] = [];
  let mismatch: boolean | null = null;
  for (const c of changes) {
    if (!c || typeof c.table !== "string" || typeof c.id !== "string" || !syncsRow(c.table, c.id)) continue;
    const table = c.table as SyncedTable;
    const updatedAt = Number(c.updatedAt) || 0;
    let id = c.id;
    // Devotion completions from an older app have no year in their key.
    const legacyDevotion = table === "devotions" ? normaliseDevotionId(id, Number(c.data?.completedAt) || updatedAt) : null;
    if (legacyDevotion) id = legacyDevotion;
    const k = `${table}:${id}`;
    if (c.deleted) {
      resolved.push({ table, id, key: k, updatedAt, kind: "delete" });
      continue;
    }
    if (!c.data || typeof c.data !== "object") continue;
    let rec: Record<string, unknown>;
    const enc = (c.data as { __enc?: unknown }).__enc;
    if (typeof enc === "string") {
      if (!key) {
        resolved.push({ table, id, key: k, updatedAt, kind: "hold", data: c.data });
        continue;
      }
      try {
        rec = await decryptJSON<Record<string, unknown>>(key, enc);
      } catch {
        resolved.push({ table, id, key: k, updatedAt, kind: "hold", data: c.data }); // another key
        continue;
      }
      // The id is outside the ciphertext: refuse a payload moved onto another row.
      if (String(rec[KEY_PATH[table]]) !== c.id) {
        console.warn(`sync: refused ${k}: encrypted payload belongs to another row`);
        continue;
      }
    } else {
      if (ALWAYS_ENCRYPTED_TABLES.has(table)) {
        console.warn(`sync: refused unencrypted ${k}: ${table} only ever travels encrypted`);
        continue;
      }
      if (ENCRYPTED_TABLES.has(table) && encrypted) {
        console.warn(`sync: refused unencrypted ${k}: this account encrypts its ${table}`);
        continue;
      }
      rec = c.data;
    }
    if (table === "settings" && id === E2E_CHECK_KEY && key) {
      mismatch = !(await checkMatches(key, rec.value));
      if (mismatch) continue; // don't replace our check with another key's
    }
    resolved.push({ table, id, key: k, updatedAt, kind: "put", rec: { ...rec, [KEY_PATH[table]]: id } });
  }
  if (!resolved.length) {
    if (mismatch !== null) await setMismatch(mismatch);
    return;
  }

  const tableNames = [...new Set(resolved.map((r) => r.table))];
  await db.transaction("rw", [...tableNames.map((t) => db.table(t)), db.outbox, db.syncHeld], async (tx) => {
    untracked(tx);
    // Read everything this batch touches up front (a pull page is up to 5000 rows).
    const keys = resolved.map((r) => r.key);
    const at = new Map(keys.map((k, i) => [k, i]));
    const [entries, heldRows] = await Promise.all([db.outbox.bulkGet(keys), db.syncHeld.bulkGet(keys)]);
    const locals = new Map<string, Record<string, unknown> | undefined>();
    for (const t of tableNames) {
      const ids = [...new Set(resolved.filter((r) => r.table === t).map((r) => r.id))];
      const rows = (await db.table(t).bulkGet(ids)) as (Record<string, unknown> | undefined)[];
      ids.forEach((id, i) => locals.set(`${t}:${id}`, rows[i]));
    }

    const puts = new Map<string, Record<string, unknown>[]>();
    const deletes = new Map<string, string[]>();
    const outboxDeletes: string[] = [];
    const outboxPuts: OutboxEntry[] = [];
    const heldPuts: HeldChange[] = [];
    const heldDeletes: string[] = [];
    const put = (t: string, row: Record<string, unknown>) => puts.set(t, [...(puts.get(t) ?? []), row]);

    for (const r of resolved) {
      // v0.4.0 server: settle an entry the server now provably holds (see confirmsSent).
      const entry = entries[at.get(r.key)!];
      if (entry && confirmsSent(entry, r.updatedAt)) outboxDeletes.push(r.key);
      const held = heldRows[at.get(r.key)!];
      if (r.kind === "hold") {
        if (!held || r.updatedAt >= held.updatedAt) heldPuts.push({ key: r.key, table: r.table, id: r.id, updatedAt: r.updatedAt, data: r.data });
        continue;
      }
      if (held && r.updatedAt >= held.updatedAt) heldDeletes.push(r.key);

      const local = locals.get(r.key);
      const localUpdated = Number(local?.updatedAt ?? 0);
      if (r.kind === "delete") {
        // Last write wins for deletes too: a newer local edit survives an older delete.
        if (local && r.updatedAt >= localUpdated) {
          deletes.set(r.table, [...(deletes.get(r.table) ?? []), r.id]);
          locals.set(r.key, undefined);
        }
        continue;
      }
      if (r.table === "plans" && local) {
        const merged = mergePlans(local as unknown as PlanProgress, r.rec as unknown as PlanProgress);
        if (samePlanProgress(merged, r.rec as unknown as PlanProgress)) {
          if (r.updatedAt >= localUpdated) {
            put(r.table, { ...r.rec, updatedAt: r.updatedAt });
            locals.set(r.key, { ...r.rec, updatedAt: r.updatedAt });
          }
        } else {
          // The merge holds something the server's copy lacks: keep it and send it back.
          const updatedAt = Math.max(nextStamp(localUpdated), r.updatedAt + 1);
          put(r.table, { ...merged, updatedAt });
          locals.set(r.key, { ...merged, updatedAt });
          outboxPuts.push({ key: r.key, table: r.table, id: r.id, op: "upsert", at: nextOutboxAt() });
          mergeQueued = true;
        }
        continue;
      }
      if (!local || r.updatedAt >= localUpdated) {
        const row = { ...r.rec, updatedAt: r.updatedAt };
        put(r.table, row);
        locals.set(r.key, row);
      }
    }

    for (const [t, ids] of deletes) await db.table(t).bulkDelete(ids);
    for (const [t, rows] of puts) await db.table(t).bulkPut(rows);
    if (outboxDeletes.length) await db.outbox.bulkDelete(outboxDeletes);
    if (outboxPuts.length) await db.outbox.bulkPut(outboxPuts);
    if (heldDeletes.length) await db.syncHeld.bulkDelete(heldDeletes);
    if (heldPuts.length) await db.syncHeld.bulkPut(heldPuts);
  });
  if (mismatch !== null) await setMismatch(mismatch);
  if (resolved.some((r) => r.kind === "hold")) emitStatus();
}

/**
 * v0.4.0 server: an entry sent with stamp `u` is settled once a pull shows the server
 * holding `u` (our own write echoed back) or something newer (which then wins by last
 * write wins) — unless it was edited after it was sent.
 */
function confirmsSent(e: OutboxEntry, updatedAt: number): boolean {
  return !!e.sent && e.sent.at === e.at && updatedAt >= e.sent.updatedAt;
}

interface PullResponse {
  changes?: RemoteChange[];
  cursor?: number;
  more?: boolean;
}
/** The v0.4.0 server's page size: a full page means there may be more. */
const LEGACY_PAGE = 5000;

async function pullAll(base: string, s: SyncState, f: ServerFeatures): Promise<Outcome> {
  let cursor = s.cursor;
  const noEcho = f.features.has("no-echo") && f.features.has("rejected");
  for (let page = 0; page < 10_000; page++) {
    const res = await api<PullResponse>(base, "/pull", { since: cursor, ...(noEcho ? { deviceId: s.deviceId } : {}) }, s.token);
    if (res.status === 401) return "auth";
    if (!res.ok || !res.data) return "offline";
    const changes = Array.isArray(res.data.changes) ? res.data.changes : [];
    if (changes.length) await applyRemote(changes);
    if (typeof res.data.cursor === "number" && res.data.cursor !== cursor) {
      cursor = res.data.cursor;
      await setState({ cursor });
    }
    const more = typeof res.data.more === "boolean" ? res.data.more : changes.length >= LEGACY_PAGE;
    if (!more) return "ok";
  }
  return "ok";
}

export async function pullChanges(): Promise<Outcome> {
  const s = await getState();
  const base = resolveUrl(s);
  if (!base || !s.token) return "ok";
  return pullAll(base, s, await serverFeatures(base));
}

/**
 * v0.4.0 server, after a pull that caught up: an entry still marked sent was ignored by
 * the server, which holds a copy at least as new that this device never applied. First
 * re-pull everything once to fetch it (last write wins then settles the entry). If that
 * doesn't settle it, re-stamp and resend; after MAX_TRIES the entry is parked as stuck
 * rather than dropped, so the change is never silently lost.
 */
async function checkUnconfirmed(base: string, f: ServerFeatures): Promise<Outcome> {
  const unconfirmed = (await db.outbox.toArray()).filter((e) => e.sent && e.sent.at === e.at && !e.stuck);
  if (!unconfirmed.length) return "ok";
  if (unconfirmed.some((e) => !e.tries)) {
    await settle(unconfirmed.map((entry) => ({ entry, action: "fail" as const })));
    const s = await setState({ cursor: 0 });
    const r = await pullAll(base, s, f);
    if (r !== "ok") return r;
  }
  const still = (await db.outbox.toArray()).filter((e) => e.sent && e.sent.at === e.at && !e.stuck && (e.tries ?? 0) >= 1);
  for (const e of still) {
    await db.transaction("rw", [db.table(e.table), db.outbox], async (tx) => {
      untracked(tx);
      const cur = await db.outbox.get(e.key);
      if (!cur || cur.at !== e.at) return;
      const tries = (cur.tries ?? 0) + 1;
      const next: OutboxEntry = { ...cur, at: nextOutboxAt(), sent: undefined, tries, stuck: tries >= MAX_TRIES };
      if (cur.op === "delete") next.stamp = nextStamp(cur.stamp ?? cur.at);
      else {
        const row = (await db.table(e.table).get(e.id)) as Record<string, unknown> | undefined;
        if (row) await db.table(e.table).put({ ...row, updatedAt: nextStamp(Math.max(Number(row.updatedAt ?? 0), cur.sent!.updatedAt)) });
      }
      await db.outbox.put(next);
    });
  }
  return "ok";
}

/* ----------------------------------- rounds ----------------------------------- */

export interface SyncRound {
  /** True when the pull reached the server's latest change: the account's values are all here. */
  caughtUp: boolean;
}
const roundListeners = new Set<(r: SyncRound) => void>();

/**
 * Observe completed sync rounds. Fires only after a round whose pull caught up with the
 * server, which is what makes it the right moment for callers to publish state this
 * device has so far held only locally: by then the account's own values have all been
 * pulled, so a fresh device adopts them instead of overwriting them with its defaults
 * (see src/store/syncedPrefs.ts). Returns an unsubscribe function.
 */
export function onSyncRound(cb: (r: SyncRound) => void): () => void {
  roundListeners.add(cb);
  return () => {
    roundListeners.delete(cb);
  };
}

async function runRound(): Promise<void> {
  let s = await getState();
  if (s.mode === "off" || !s.token || s.authError || s.pendingAccountChoice) return;
  const base = resolveUrl(s);
  if (!base) return;
  const f = await serverFeatures(base);
  s = await refreshTokenIfDue(base, s, f);

  let outcome = await push(base, s, f);
  if (outcome !== "auth") {
    let pulled = await pullAll(base, s, f);
    // Merging plan progress can queue our merged copy for upload; send it now, and pull
    // again so a v0.4.0 server's echo settles it before the unconfirmed check.
    for (let i = 0; i < 3 && pulled === "ok" && mergeQueued; i++) {
      mergeQueued = false;
      const r = await push(base, s, f);
      if (r !== "ok") {
        outcome = r;
        break;
      }
      pulled = await pullAll(base, await getState(), f);
    }
    if (pulled !== "ok") outcome = pulled;
    else if (!f.features.has("rejected")) outcome = (await checkUnconfirmed(base, f)) === "auth" ? "auth" : outcome;
    if (pulled === "ok") {
      await setState({ lastSyncAt: Date.now() });
      await ensureCheckRow();
      for (const cb of roundListeners) {
        try {
          cb({ caughtUp: true });
        } catch (e) {
          console.error("sync round listener failed", e);
        }
      }
    }
  }
  if (outcome === "auth") await setState({ authError: true });
}

let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;
/** Run a sync round now. A call during a round runs one more round after it; both callers wait for it. */
export function syncNow(): Promise<void> {
  if (!running) {
    running = runRound()
      .catch((e) => console.error("sync round failed", e))
      .finally(() => {
        running = null;
      });
    return running;
  }
  queued ??= running.then(() => {
    queued = null;
    return syncNow();
  });
  return queued;
}

let debounce: ReturnType<typeof setTimeout> | null = null;
let autoSync = true;
/** Stop (or restart) the automatic push after local edits. The tests drive rounds by hand. */
export function setAutoSync(on: boolean): void {
  autoSync = on;
  if (!on && debounce) clearTimeout(debounce);
}
function scheduleSync(): void {
  if (!autoSync) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), 1500);
}

// Local edits land in the outbox (src/db/syncTracking.ts); push them soon after.
onQueued(scheduleSync);

let started = false;
export function startSync(): void {
  if (started) return;
  started = true;
  void syncNow();
  setInterval(() => void syncNow(), 60_000);
  if (typeof window !== "undefined") window.addEventListener("online", () => void syncNow());
}

export interface SyncStatus {
  mode: SyncMode;
  email: string | null;
  url: string | null;
  lastSyncAt: number | null;
  /** Changes waiting to upload. */
  pending: number;
  /** Changes held back until this device has the recovery phrase. */
  waitingForKey: number;
  /** Changes the server keeps refusing; they stay on this device. */
  stuck: number;
  /** The server no longer accepts this device's sign-in. */
  signedOut: boolean;
  /** Waiting for the user to decide what happens to this device's data (see resolveAccountChoice). */
  needsAccountChoice: boolean;
}
export async function getSyncStatus(): Promise<SyncStatus> {
  const s = await getState();
  const entries = await db.outbox.toArray();
  const key = loadDataKey();
  const encrypted = await accountEncrypted(key);
  const waitingForKey = entries.filter(
    (e) => !e.stuck && ((!key && encrypted && ENCRYPTED_TABLES.has(e.table)) || (!key && ALWAYS_ENCRYPTED_TABLES.has(e.table) && e.op !== "delete")),
  ).length;
  const stuck = entries.filter((e) => e.stuck).length;
  return {
    mode: s.mode,
    email: s.email,
    url: s.url,
    lastSyncAt: s.lastSyncAt,
    pending: entries.length - stuck - waitingForKey,
    waitingForKey,
    stuck,
    signedOut: s.authError,
    needsAccountChoice: s.pendingAccountChoice,
  };
}

/* ------------------------------- key sync gate -------------------------------- */

/**
 * Whether this device can share the user's API keys (src/store/keySync.ts), and if not,
 * why: not signed in, no encryption key here, the wrong key, or a server that cannot
 * store them (v0.4.0). `offline` means the server could not be asked just now.
 */
export type KeySyncGate = "signed-out" | "no-e2e" | "key-mismatch" | "old-server" | "offline" | "ready";
export async function keySyncGate(): Promise<KeySyncGate> {
  const s = await getState();
  const base = resolveUrl(s);
  if (s.mode === "off" || !s.token || !base) return "signed-out";
  if (!loadDataKey()) return "no-e2e";
  if (s.keyMismatch) return "key-mismatch";
  const f = await serverFeatures(base);
  if (!f.reachable) return "offline";
  return f.features.has(TABLE_FEATURES.apiKeys ?? "apiKeys") ? "ready" : "old-server";
}

/** True when this device may write key rows: signed in, holding the account's data key. */
export async function canWriteSecrets(): Promise<boolean> {
  const s = await getState();
  return s.mode !== "off" && !!s.token && !!loadDataKey() && !s.keyMismatch;
}

/* ------------------------------ E2E encryption controls ---------------------- */

const CHECK_PLAINTEXT = "bread-of-life:e2e-check:v1";

async function checkMatches(key: Uint8Array, value: unknown): Promise<boolean> {
  if (typeof value !== "string") return false;
  try {
    return (await decryptJSON<string>(key, value)) === CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}

async function setMismatch(mismatch: boolean): Promise<void> {
  const s = await getState();
  if (s.keyMismatch !== mismatch) {
    await setState({ keyMismatch: mismatch });
    emitStatus();
  }
}

/**
 * Accounts that turned encryption on before v0.5 have no check row. Once this device
 * has the key and has caught up (so it isn't about to overwrite another device's), add one.
 */
async function ensureCheckRow(): Promise<void> {
  const key = loadDataKey();
  if (!key || (await db.settings.get(E2E_CHECK_KEY))) return;
  if ((await getState()).keyMismatch) return;
  await db.settings.put({ key: E2E_CHECK_KEY, value: await encryptJSON(key, CHECK_PLAINTEXT) });
}

export interface E2EStatus {
  /** This device has the data key. */
  enabled: boolean;
  /** Synced entries are locked here until the recovery phrase is entered. */
  needsKey: boolean;
  /** This device's key isn't the one the account uses. */
  keyMismatch: boolean;
  /** The account already uses encryption (so turning it on means entering the phrase). */
  accountEncrypted: boolean;
}
export async function getE2EStatus(): Promise<E2EStatus> {
  const key = loadDataKey();
  const held = await db.syncHeld.count();
  const s = await getState();
  const encrypted = await accountEncrypted(key);
  return { enabled: !!key, needsKey: held > 0 || (!key && encrypted), keyMismatch: s.keyMismatch, accountEncrypted: encrypted };
}

/**
 * Turn on E2E for this account: generate a data key, keep it device-local, and re-push
 * all existing personal content encrypted. Returns the 24-word recovery phrase to show
 * ONCE (the only way to restore on another device) — or `account-has-key` when the
 * account already encrypts, in which case the user must enter that phrase instead
 * (a second key would leave each device unable to read the other's entries).
 */
export async function enableE2E(): Promise<{ ok: true; phrase: string } | { ok: false; reason: "account-has-key" }> {
  const s = await getState();
  if (s.mode !== "off" && s.token) await syncNow(); // see what the account already has
  if ((await db.settings.get(E2E_CHECK_KEY)) || (await db.syncHeld.count()) > 0) return { ok: false, reason: "account-has-key" };
  const key = generateDataKey();
  saveDataKey(key);
  await setMismatch(false);
  await db.settings.put({ key: E2E_CHECK_KEY, value: await encryptJSON(key, CHECK_PLAINTEXT) });
  await enqueueAll(
    SYNCED_TABLES.filter((t) => ENCRYPTED_TABLES.has(t)),
    { bump: true },
  );
  void syncNow();
  return { ok: true, phrase: await keyToPhrase(key) };
}

/**
 * Restore E2E on a device from the recovery phrase: unlock the held entries and re-pull
 * everything (older versions skipped rows they couldn't read). `mismatch` means the phrase
 * is valid but belongs to a different key than this account's.
 */
export async function restoreE2E(phrase: string): Promise<"ok" | "invalid" | "mismatch"> {
  const key = await phraseToKey(phrase);
  if (!key) return "invalid";
  const check = await db.settings.get(E2E_CHECK_KEY);
  const sample = await db.syncHeld.limit(1).first();
  if (check && !(await checkMatches(key, check.value))) return "mismatch";
  if (!check && sample) {
    try {
      await decryptJSON(key, String((sample.data as { __enc?: unknown }).__enc));
    } catch {
      return "mismatch";
    }
  }
  saveDataKey(key);
  await setMismatch(false);
  const held: HeldChange[] = await db.syncHeld.toArray();
  await db.syncHeld.clear();
  await applyRemote(held.map((h) => ({ table: h.table, id: h.id, updatedAt: h.updatedAt, deleted: false, data: h.data })));
  await setState({ cursor: 0 });
  emitStatus();
  await syncNow();
  return "ok";
}

/** Show the current device's recovery phrase again (E2E must be on). */
export async function getRecoveryPhrase(): Promise<string | null> {
  const key = loadDataKey();
  return key ? keyToPhrase(key) : null;
}

/**
 * Forget the key on THIS device. Local plaintext is untouched and the server keeps its
 * ciphertext; journal, prayer and note changes made here wait (unsynced) until the
 * recovery phrase is entered again, because the account still encrypts.
 */
export function disableE2E(): void {
  clearDataKey();
  emitStatus();
}

/**
 * "Sync my keys to my other devices": the user's own Bible API keys (ESV, NLT, API.Bible),
 * shared between their devices ONLY end-to-end encrypted.
 *
 * The keys the app reads stay where they always were, in the UI store (`bibleKeys`,
 * localStorage, per device). With the per-device switch on, this module mirrors them into
 * the synced `apiKeys` Dexie table, which src/db/sync.ts encrypts with the account's data
 * key before upload and never sends otherwise (see ALWAYS_ENCRYPTED_TABLES), and mirrors
 * pulled rows back into the store:
 *
 *  - A key saved here is written to its row; a key removed here deletes the row, so the
 *    tombstone removes it from the other devices too.
 *  - A pulled key fills an empty slot, and replaces a key only if that key was the synced
 *    one (another device changed it). A different key the user entered on this device is
 *    never overwritten: the settings card offers the choice instead (`adoptSyncedKey`,
 *    `shareKeyHere`).
 *  - A key removed elsewhere is removed here only if it is still the synced one.
 *  - Turning the switch off stops all of this and leaves every local key in place.
 *
 * Rows are written only while this device holds the account's data key (the Dexie
 * middleware throws otherwise), and a key that has no row yet is uploaded only after a
 * sync round has caught up, so a device that has not pulled yet cannot overwrite the key
 * the account already holds.
 */
import { liveQuery, type Subscription } from "dexie";
import { db, type SyncedApiKey } from "@/db";
import { canWriteSecrets, onSyncRound, syncNow } from "@/db/sync";
import { useUI, type BibleKeys } from "./ui";

export type KeyId = keyof BibleKeys;
export const KEY_IDS: readonly KeyId[] = ["esv", "nlt", "apiBible"];

/** Per key, what the settings card shows. */
export type KeySyncState =
  | { kind: "off" } // switch off, or no key anywhere
  | { kind: "shared" } // this device's key is the synced one, set here
  | { kind: "from-other" } // this device uses the key that came from another device
  | { kind: "pending" } // saved here, waiting to be shared (not caught up yet, or no row written)
  | { kind: "conflict"; other: string }; // the other devices use a different key

let caughtUp = false;
let chain: Promise<void> = Promise.resolve();
/** True while this module writes the store, so the store watcher doesn't echo it back. */
let applying = false;
/** Keys changed in the store whose write to `apiKeys` hasn't run yet: reconcile leaves them alone. */
const pendingLocal = new Set<KeyId>();

function setAgreed(id: KeyId, v: { value: string; from: "here" | "other" } | null): void {
  const next = { ...useUI.getState().keySyncAgreed };
  if (v) next[id] = v;
  else delete next[id];
  useUI.setState({ keySyncAgreed: next });
}

function setLocal(id: KeyId, value: string): void {
  applying = true;
  try {
    useUI.getState().setBibleKey(id, value);
  } finally {
    applying = false;
  }
}

async function readRows(): Promise<Map<KeyId, SyncedApiKey>> {
  const rows = await db.apiKeys.toArray();
  return new Map(rows.filter((r) => KEY_IDS.includes(r.id) && typeof r.value === "string" && r.value).map((r) => [r.id, r]));
}

/** Forget the cached licensed text of a key removed elsewhere (the licence caps it). */
function forgetCache(id: KeyId): void {
  void import("@/data/licensed")
    .then(async (m) => {
      if (id === "esv") await m.clearLicensedCache(m.ESV_TRANSLATION);
      else if (id === "nlt") await m.clearLicensedCache(m.NLT_TRANSLATION);
      else for (const b of useUI.getState().apiBibleBibles) await m.clearLicensedCache(m.apiBibleTranslation(b));
    })
    .catch(() => {});
}

/**
 * Bring the store and the synced rows into line (see the module comment). `seed` allows
 * uploading a key the account doesn't have yet; it is honoured only once a round has
 * caught up. Serialised, so overlapping calls never race.
 */
export function reconcileKeys({ seed = true }: { seed?: boolean } = {}): Promise<void> {
  return serial(() => reconcile(seed));
}

/** Run `fn` after everything key sync has already started (writes and reconciles in order). */
function serial(fn: () => Promise<void>): Promise<void> {
  const run = chain.then(fn);
  chain = run.catch((e) => console.error("key sync failed", e));
  return run;
}

/** Resolves once every key write and reconcile started so far has finished. */
export function keySyncIdle(): Promise<void> {
  return chain;
}

async function reconcile(seed: boolean): Promise<void> {
  const st = useUI.getState();
  if (!st.keySync) return;
  const rows = await readRows();
  const canWrite = await canWriteSecrets();
  for (const id of KEY_IDS) {
    if (pendingLocal.has(id)) continue; // the user's own change comes first
    const local = useUI.getState().bibleKeys[id];
    const agreed = useUI.getState().keySyncAgreed[id];
    const row = rows.get(id);
    if (row) {
      if (local === row.value) {
        if (agreed?.value !== local) setAgreed(id, { value: local, from: "here" });
      } else if (!local || (agreed && local === agreed.value)) {
        // An empty slot, or the synced key was replaced on another device.
        setLocal(id, row.value);
        setAgreed(id, { value: row.value, from: "other" });
      } else if (agreed && row.value === agreed.value && canWrite) {
        // Changed here while it could not be shared: share it now.
        await db.apiKeys.put({ id, value: local });
        setAgreed(id, { value: local, from: "here" });
      }
      // Otherwise: two different keys. Leave both; the card offers the choice.
    } else if (local && agreed && local === agreed.value) {
      // It was synced and the row is gone: removed on another device.
      setLocal(id, "");
      setAgreed(id, null);
      forgetCache(id);
    } else if (local && seed && caughtUp && canWrite) {
      await db.apiKeys.put({ id, value: local });
      setAgreed(id, { value: local, from: "here" });
    }
  }
}

/** A key saved or removed on this device, with the switch on. */
async function onLocalChange(id: KeyId, value: string): Promise<void> {
  pendingLocal.delete(id);
  if (!useUI.getState().keySync || !(await canWriteSecrets())) return;
  const row = await db.apiKeys.get(id);
  if (value) {
    if (row?.value !== value) await db.apiKeys.put({ id, value });
    setAgreed(id, { value, from: "here" });
  } else {
    if (row) await db.apiKeys.delete(id); // the tombstone removes it everywhere
    setAgreed(id, null);
  }
}

/** Turn the switch on or off. On: pull first, then share what the account lacks. */
export async function setKeySyncEnabled(on: boolean): Promise<void> {
  useUI.getState().setKeySync(on);
  if (!on) {
    // Stop syncing; local keys stay. Forget what was agreed, so turning it back on
    // treats every key afresh instead of reading an old agreement as a removal.
    useUI.setState({ keySyncAgreed: {} });
    return;
  }
  await syncNow();
  await reconcileKeys();
  await syncNow();
}

/** Use the key the other devices hold, on this device. */
export async function adoptSyncedKey(id: KeyId): Promise<void> {
  const row = await db.apiKeys.get(id);
  if (!row?.value) return;
  setLocal(id, row.value);
  setAgreed(id, { value: row.value, from: "other" });
}

/** Share this device's key with the other devices, replacing theirs. */
export async function shareKeyHere(id: KeyId): Promise<void> {
  const value = useUI.getState().bibleKeys[id];
  if (!value || !(await canWriteSecrets())) return;
  await db.apiKeys.put({ id, value });
  setAgreed(id, { value, from: "here" });
  void syncNow();
}

/** What the card shows for one key, from the store and the synced row. */
export function keySyncState(
  id: KeyId,
  s: Pick<ReturnType<typeof useUI.getState>, "keySync" | "bibleKeys" | "keySyncAgreed">,
  row: SyncedApiKey | undefined,
): KeySyncState {
  const local = s.bibleKeys[id];
  if (!s.keySync || (!local && !row?.value)) return { kind: "off" };
  if (row?.value && local && row.value !== local) return { kind: "conflict", other: row.value };
  if (row?.value && row.value === local) return s.keySyncAgreed[id]?.from === "other" ? { kind: "from-other" } : { kind: "shared" };
  return { kind: "pending" };
}

/** The synced rows, live (for the card). */
export function watchSyncedKeys(cb: (rows: Map<KeyId, SyncedApiKey>) => void): () => void {
  const sub: Subscription = liveQuery(readRows).subscribe({ next: cb, error: (e) => console.error("key sync: watch failed", e) });
  return () => sub.unsubscribe();
}

let started = false;
let stops: (() => void)[] = [];

/** Wire the store ⇄ `apiKeys` mirror. Idempotent; called once at startup. */
export function startKeySync(): void {
  if (started) return;
  started = true;
  stops.push(
    useUI.subscribe((state, prev) => {
      if (applying || state.bibleKeys === prev.bibleKeys) return;
      for (const id of KEY_IDS) {
        if (state.bibleKeys[id] !== prev.bibleKeys[id]) {
          const value = state.bibleKeys[id];
          pendingLocal.add(id);
          void serial(() => onLocalChange(id, value)).catch(() => {});
        }
      }
    }),
  );
  stops.push(
    onSyncRound(({ caughtUp: c }) => {
      if (!c) return;
      caughtUp = true;
      void reconcileKeys();
    }),
  );
  // Pulled rows (and a restored recovery phrase unlocking held ones) land here.
  stops.push(watchSyncedKeys(() => void reconcileKeys({ seed: false })));
}

/** Tear down (tests). */
export function stopKeySync(): void {
  for (const s of stops) s();
  stops = [];
  started = false;
  caughtUp = false;
}

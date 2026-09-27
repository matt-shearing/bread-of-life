import type { DBCore, DBCoreMutateRequest, DBCoreMutateResponse, DBCoreTable, DBCoreTransaction, Middleware } from "dexie";
import { KEY_PATH, isSyncedTable, syncsRow, type SyncedTable } from "./syncSchema";

/**
 * Change tracking for sync, as a Dexie DBCore middleware.
 *
 * Every write to a synced table, in the same IndexedDB transaction as the write:
 *  1. stamps the row's `updatedAt` with a MONOTONIC stamp, `max(now, previous + 1)`. A row
 *     pulled from a device whose clock runs fast carries a future stamp; a plain
 *     `Date.now()` edit made after it would lose to it on the server and vanish.
 *  2. records the change key in `outbox`, which the push reads.
 *
 * Doing both inside the write's own transaction means a change can't be written without
 * also being queued (the old Dexie hooks queued it in a setTimeout after the commit, so
 * a kill in between lost it), and nothing needs installing after the first render.
 *
 * A transaction flagged with `untracked()` (the engine applying pulled rows, and the
 * few bookkeeping writes that must keep a row's stamp) passes through unchanged, as do
 * schema upgrades.
 */

const NO_TRACK = "__bolNoTrack";
type Trans = DBCoreTransaction & { mode?: IDBTransactionMode; [NO_TRACK]?: boolean };

/** Flag an open Dexie transaction so writes in it are neither stamped nor queued. */
export function untracked(tx: { idbtrans: unknown } | null | undefined): void {
  if (tx?.idbtrans) (tx.idbtrans as Trans)[NO_TRACK] = true;
}

/** `max(now, previous + 1)`: later than the previous stamp even if this clock is behind. */
export function nextStamp(previous: unknown): number {
  const p = Number(previous);
  return Math.max(Date.now(), Number.isFinite(p) ? p + 1 : 0);
}

let lastAt = 0;
/**
 * A unique, increasing marker for an outbox entry. The push compares it before and after
 * a request: an entry whose marker moved was edited meanwhile and must stay queued.
 */
export function nextOutboxAt(): number {
  lastAt = Math.max(Date.now(), lastAt + 1);
  return lastAt;
}

const queuedListeners = new Set<() => void>();
/** Called whenever a change is queued (the engine debounces a push off this). */
export function onQueued(cb: () => void): () => void {
  queuedListeners.add(cb);
  return () => {
    queuedListeners.delete(cb);
  };
}

async function queue(
  outbox: DBCoreTable,
  trans: DBCoreTransaction,
  table: SyncedTable,
  changes: { id: unknown; op: "upsert" | "delete"; stamp?: number }[],
): Promise<void> {
  const values = [];
  for (const c of changes) {
    const id = String(c.id);
    if (!syncsRow(table, id)) continue; // a device-local setting
    values.push({ key: `${table}:${id}`, table, id, op: c.op, at: nextOutboxAt(), ...(c.stamp ? { stamp: c.stamp } : {}) });
  }
  if (!values.length) return;
  await outbox.mutate({ type: "put", trans, values });
  for (const cb of queuedListeners) cb();
}

/**
 * For a put that finds no row (a re-create, such as undoing a delete), the stamp to beat.
 * The delete's tombstone was stamped after the row it removed, which can be in the
 * future if that row was last edited on a device whose clock runs fast; a re-create
 * stamped with plain `now` would lose to it and the server would keep the item deleted.
 * So the floor is the later of the tombstone still waiting in the outbox and the stamp
 * the written row already carries (an undo passes the row as it was, and its tombstone
 * was that stamp + 1, which covers a tombstone already pushed).
 */
async function recreateFloors(
  outbox: DBCoreTable,
  trans: DBCoreTransaction,
  table: SyncedTable,
  keys: unknown[],
  prev: unknown[],
  values: readonly unknown[],
): Promise<(number | undefined)[]> {
  const missing = keys.flatMap((_, i) => (prev[i] ? [] : [i]));
  const floors: (number | undefined)[] = keys.map(() => undefined);
  if (!missing.length) return floors;
  const pending = (await outbox.getMany({ trans, keys: missing.map((i) => `${table}:${String(keys[i])}`) })) as
    | ({ op?: string; stamp?: number } | undefined)[];
  missing.forEach((i, j) => {
    const tomb = pending[j]?.op === "delete" ? Number(pending[j]?.stamp) : NaN;
    const own = Number((values[i] as Record<string, unknown> | undefined)?.updatedAt);
    const best = Math.max(Number.isFinite(tomb) ? tomb : -Infinity, Number.isFinite(own) ? own + 1 : -Infinity);
    if (Number.isFinite(best)) floors[i] = best;
  });
  return floors;
}

function trackTable(table: DBCoreTable, outbox: DBCoreTable, name: SyncedTable): DBCoreTable {
  const keyPath = KEY_PATH[name];
  return {
    ...table,
    async mutate(req: DBCoreMutateRequest): Promise<DBCoreMutateResponse> {
      const trans = req.trans as Trans;
      if (trans[NO_TRACK] || trans.mode === "versionchange") return table.mutate(req);

      if (req.type === "add" || req.type === "put") {
        const keys = req.values.map((v) => (v as Record<string, unknown>)?.[keyPath]);
        const prev = await table.getMany({ trans, keys });
        const floors = await recreateFloors(outbox, trans, name, keys, prev, req.values);
        const values = req.values.map((v, i) => ({ ...v, updatedAt: nextStamp(prev[i] ? prev[i].updatedAt : floors[i]) }));
        const res = await table.mutate({ ...req, values });
        await queue(
          outbox,
          trans,
          name,
          keys.filter((_, i) => !res.failures[i]).map((id) => ({ id, op: "upsert" as const })),
        );
        return res;
      }

      // delete / deleteRange: tombstones for the rows that actually existed, stamped
      // after the row they remove.
      const keys =
        req.type === "delete"
          ? req.keys
          : (await table.query({ trans, values: false, query: { index: table.schema.primaryKey, range: req.range } })).result;
      const prev = await table.getMany({ trans, keys });
      const res = await table.mutate(req);
      await queue(
        outbox,
        trans,
        name,
        keys.flatMap((id, i) => (prev[i] ? [{ id, op: "delete" as const, stamp: nextStamp(prev[i]?.updatedAt) }] : [])),
      );
      return res;
    },
  };
}

export const syncTracking: Middleware<DBCore> = {
  stack: "dbcore",
  name: "bol-sync-tracking",
  create(down) {
    return {
      ...down,
      // Every read-write transaction over a synced table also covers `outbox`, so the
      // queue entry commits (or rolls back) with the change itself.
      transaction(stores, mode, options) {
        const scope =
          mode === "readwrite" && stores.some(isSyncedTable) && !stores.includes("outbox") ? [...stores, "outbox"] : stores;
        return down.transaction(scope, mode, options);
      },
      table(name) {
        const table = down.table(name);
        return isSyncedTable(name) ? trackTable(table, down.table("outbox"), name) : table;
      },
    };
  },
};

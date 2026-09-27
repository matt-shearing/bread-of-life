/**
 * Back up every piece of user data to one JSON file, and restore it again.
 *
 * Without sync, the phone is the only copy of years of prayers and journal entries.
 * This is the belt to sync's braces: a file you can keep anywhere, that restores
 * onto any device running the app.
 *
 * What is in a backup: exactly the rows that sync (src/db/syncSchema.ts) —
 * highlights, notes, prayers, journal, reading progress, settings, plans, devotions,
 * custom plans and memory verses. What is not: caches (downloaded commentary and
 * Bible translations, which re-download), and sync bookkeeping (the outbox and the
 * account/cursor row), which describe this device's conversation with a server.
 *
 * Restoring MERGES; it never wipes. Each row in the file is matched to the local row
 * with the same primary key and the newer one (by `updatedAt`) wins. So restoring an
 * old backup onto a device that has moved on keeps the newer local work, and
 * restoring the same file twice changes nothing the second time.
 */
import { db, type PlanProgress } from "@/db";
import { getState, syncNow } from "@/db/sync";
import { KEY_PATH as SYNCED_KEY_PATH, SYNCED_TABLES, syncsRow, type SyncedTable } from "@/db/syncSchema";
import { nextOutboxAt, nextStamp, untracked } from "@/db/syncTracking";
import { mergePlans, samePlanProgress } from "@/db/planMerge";
import { localDayKey } from "@/lib/day";

export const BACKUP_APP = "bread-of-life";
export const BACKUP_FORMAT = 1;


type Row = Record<string, unknown>;

export interface BackupFile {
  app: typeof BACKUP_APP;
  format: number;
  /** ISO 8601, UTC. */
  exportedAt: string;
  appVersion: string;
  /** The Dexie schema version of the device that wrote it. Informational. */
  dbVersion: number;
  tables: Partial<Record<SyncedTable, Row[]>>;
}

/** A backup file this version cannot read. The message is written for the user. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

/** `bread-of-life-backup-2026-09-27.json`, dated by the LOCAL calendar day. */
export function backupFileName(now: number = Date.now()): string {
  return `bread-of-life-backup-${localDayKey(now)}.json`;
}

/**
 * Rows that describe THIS device rather than its owner stay out of a backup and are
 * ignored in one. That is every `settings` row sync doesn't carry (the allow-list in
 * src/db/syncSchema.ts): a Missler library path, say, is a folder on one particular
 * disk, and pointing another device at it would switch the feature on and break it.
 */
const isDeviceLocal = (t: SyncedTable, row: Row) => !syncsRow(t, String(row[SYNCED_KEY_PATH[t]]));

/** Read every user table in one transaction, so the snapshot is consistent. */
export async function createBackup(appVersion: string, now: number = Date.now()): Promise<BackupFile> {
  const tables: Partial<Record<SyncedTable, Row[]>> = {};
  await db.transaction(
    "r",
    SYNCED_TABLES.map((t) => db.table(t)),
    async () => {
      for (const t of SYNCED_TABLES) {
        const rows = (await db.table(t).toArray()) as Row[];
        tables[t] = rows.filter((r) => !isDeviceLocal(t, r));
      }
    },
  );
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    exportedAt: new Date(now).toISOString(),
    appVersion,
    dbVersion: db.verno,
    tables,
  };
}

export function serializeBackup(b: BackupFile): string {
  return JSON.stringify(b, null, 1);
}

/* ---------------------------------- reading ---------------------------------- */

const isPlainObject = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ParsedBackup {
  backup: BackupFile;
  /** Rows that had no usable primary key, per table; they are skipped. */
  invalidRows: number;
  /** Tables in the file this version doesn't know (from a newer app); skipped. */
  unknownTables: string[];
}

/**
 * Parse and validate a backup file's text. Throws BackupError with a message fit to
 * show the user when the file is not a backup this version can read.
 */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("That file isn’t a Bread of Life backup — it isn’t readable JSON.");
  }
  if (!isPlainObject(raw) || raw.app !== BACKUP_APP) {
    throw new BackupError("That file isn’t a Bread of Life backup.");
  }
  if (typeof raw.format !== "number" || !Number.isInteger(raw.format) || raw.format < 1) {
    throw new BackupError("That backup is damaged: it doesn’t say which format it uses.");
  }
  if (raw.format > BACKUP_FORMAT) {
    throw new BackupError("That backup was made by a newer version of Bread of Life. Update the app, then restore it.");
  }
  if (!isPlainObject(raw.tables)) {
    throw new BackupError("That backup is damaged: it has no data in it.");
  }

  const known = new Set<string>(SYNCED_TABLES);
  const tables: Partial<Record<SyncedTable, Row[]>> = {};
  const unknownTables: string[] = [];
  let invalidRows = 0;
  for (const [name, rows] of Object.entries(raw.tables)) {
    if (!known.has(name)) {
      unknownTables.push(name);
      continue;
    }
    const t = name as SyncedTable;
    if (!Array.isArray(rows)) throw new BackupError(`That backup is damaged: “${name}” isn’t a list.`);
    const keyPath = SYNCED_KEY_PATH[t];
    const good: Row[] = [];
    for (const r of rows) {
      if (isPlainObject(r) && typeof r[keyPath] === "string" && r[keyPath] !== "") good.push(r);
      else invalidRows++;
    }
    tables[t] = good;
  }

  return {
    backup: {
      app: BACKUP_APP,
      format: raw.format,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
      appVersion: typeof raw.appVersion === "string" ? raw.appVersion : "",
      dbVersion: typeof raw.dbVersion === "number" ? raw.dbVersion : 0,
      tables,
    },
    invalidRows,
    unknownTables,
  };
}

/* ------------------------------- merge decisions ----------------------------- */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * When a row was last changed. `updatedAt` is stamped on every write by the sync
 * middleware (src/db/syncTracking.ts); rows written before sync existed lack it, so fall back to the newest
 * timestamp the row itself carries.
 */
export function rowStamp(table: SyncedTable, row: Row): number {
  const u = num(row.updatedAt);
  if (u !== null) return u;
  const candidates: unknown[] = [row.createdAt];
  if (table === "progress") candidates.push(row.at);
  if (table === "devotions") candidates.push(row.completedAt);
  if (table === "prayers") candidates.push(row.lastPrayedAt, row.answeredAt);
  if (table === "memory") candidates.push(row.lastReviewedAt);
  if (table === "plans") candidates.push(row.startedAt);
  return Math.max(0, ...candidates.map(num).filter((n): n is number => n !== null));
}

/** Key-order-independent JSON, so two copies of the same row compare equal. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export type Decision = "add" | "update" | "keep" | "same";

/**
 * What restoring `incoming` over `local` should do, and the row to write if anything:
 *  - add:    nothing local with this key; write the backup's row (restamped by
 *            `applyRestore` when this device is synced, see `stampAdds`).
 *  - same:   identical already; nothing to write.
 *  - update: the backup's copy is strictly newer; write it, keeping its own stamp.
 *  - keep:   the local copy is newer (or as new) and differs; it stays.
 *
 * Reading-plan progress is the exception, as it is for a pull: the two copies merge day
 * by day (src/db/planMerge.ts), so a day ticked only in the backup comes back without
 * un-ticking days finished here since. A merge that adds something is new content, so
 * it gets a fresh stamp and uploads over the server's copy (where it merges again).
 */
export function decide(table: SyncedTable, local: Row | undefined, incoming: Row): { d: Decision; row?: Row } {
  if (!local) return { d: "add", row: incoming };
  if (canonical(local) === canonical(incoming)) return { d: "same" };
  if (table === "plans") {
    const merged = mergePlans(local as unknown as PlanProgress, incoming as unknown as PlanProgress);
    if (samePlanProgress(merged, local as unknown as PlanProgress)) return { d: "keep" };
    const updatedAt = Math.max(nextStamp(local.updatedAt), (num(incoming.updatedAt) ?? 0) + 1);
    return { d: "update", row: { ...(merged as unknown as Row), updatedAt } };
  }
  return rowStamp(table, incoming) > rowStamp(table, local) ? { d: "update", row: incoming } : { d: "keep" };
}

/* ---------------------------------- preview ---------------------------------- */

export interface TableTally {
  /** Rows in the file (after dropping device-only settings). */
  inFile: number;
  add: number;
  update: number;
  keep: number;
  same: number;
}

export interface RestorePlan {
  parsed: ParsedBackup;
  tables: Partial<Record<SyncedTable, TableTally>>;
  totals: { inFile: number; add: number; update: number; keep: number; same: number };
  /** Device-only settings in the file that will not be applied. */
  skippedDeviceSettings: number;
}

function importable(t: SyncedTable, rows: Row[] | undefined): Row[] {
  return (rows ?? []).filter((r) => !isDeviceLocal(t, r));
}

/** Work out what a restore would do, without writing anything. */
export async function previewRestore(parsed: ParsedBackup): Promise<RestorePlan> {
  const tables: Partial<Record<SyncedTable, TableTally>> = {};
  const totals = { inFile: 0, add: 0, update: 0, keep: 0, same: 0 };
  let skippedDeviceSettings = 0;
  for (const t of SYNCED_TABLES) {
    const all = parsed.backup.tables[t];
    if (!all) continue;
    const rows = importable(t, all);
    skippedDeviceSettings += all.length - rows.length;
    const keyPath = SYNCED_KEY_PATH[t];
    const locals = (await db.table(t).bulkGet(rows.map((r) => r[keyPath] as string))) as (Row | undefined)[];
    const tally: TableTally = { inFile: rows.length, add: 0, update: 0, keep: 0, same: 0 };
    rows.forEach((r, i) => {
      tally[decide(t, locals[i], r).d]++;
    });
    tables[t] = tally;
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += tally[k];
  }
  return { parsed, tables, totals, skippedDeviceSettings };
}

export interface RestoreResult {
  added: number;
  updated: number;
  kept: number;
  unchanged: number;
}

/**
 * Apply a restore, in one transaction over every user table and the outbox.
 *
 * The transaction is flagged `untracked` (src/db/syncTracking.ts), so the sync
 * middleware neither restamps nor queues these writes. Restamping is the danger: every
 * restored row would then count as edited now, and a month-old backup would beat edits
 * made since on other devices the moment it uploaded. Instead each row keeps its own
 * `updatedAt` (except rows added on a synced device, see `stampAdds`), and exactly the
 * rows written are queued by hand in the same transaction, so they upload and the
 * server's last-write-wins sorts them out.
 *
 * The decisions are made again here rather than reused from the preview, so an edit
 * made while the preview was open is still respected.
 */
/**
 * Whether rows the restore ADDS get a fresh stamp. On a device that is signed in and
 * has pulled from its account, a row missing here is missing from the account too:
 * either it never reached it, or it was deleted there. If it was deleted, the server
 * holds a tombstone newer than the backup's stamp, so a row restored with its old stamp
 * would lose and be deleted again on the next sync, after the preview promised to add
 * it. A fresh stamp makes the restore win, which is what pressing Restore asked for.
 *
 * A device that has not pulled yet can't tell "deleted on the account" from "not
 * downloaded yet", and a fresh stamp there would let a months-old copy overwrite newer
 * edits on the account. Those rows keep their own stamp and the account's copy decides.
 * Rows the restore UPDATES always keep their own stamp: there is a real local copy to
 * compare against.
 */
async function stampAdds(): Promise<boolean> {
  const s = await getState();
  return s.mode !== "off" && !!s.token && s.cursor > 0 && !s.pendingAccountChoice;
}

export async function applyRestore(parsed: ParsedBackup): Promise<RestoreResult> {
  const result: RestoreResult = { added: 0, updated: 0, kept: 0, unchanged: 0 };
  let queued = 0;
  const restamp = await stampAdds();
  await db.transaction("rw", [...SYNCED_TABLES.map((t) => db.table(t)), db.outbox], async (tx) => {
    untracked(tx);
    for (const t of SYNCED_TABLES) {
      const rows = importable(t, parsed.backup.tables[t]);
      if (!rows.length) continue;
      const keyPath = SYNCED_KEY_PATH[t];
      const table = db.table(t);
      const ids = rows.map((r) => r[keyPath] as string);
      const locals = (await table.bulkGet(ids)) as (Row | undefined)[];
      const toPut: Row[] = [];
      const entries: { key: string; table: string; id: string; op: "upsert"; at: number }[] = [];
      rows.forEach((r, i) => {
        const { d, row } = decide(t, locals[i], r);
        if (row) {
          toPut.push(d === "add" && restamp ? { ...row, updatedAt: nextStamp(rowStamp(t, row)) } : row);
          entries.push({ key: `${t}:${ids[i]}`, table: t, id: ids[i], op: "upsert", at: nextOutboxAt() });
        }
        if (d === "add") result.added++;
        else if (d === "update") result.updated++;
        else if (d === "keep") result.kept++;
        else result.unchanged++;
      });
      if (toPut.length) {
        await table.bulkPut(toPut);
        await db.outbox.bulkPut(entries);
        queued += entries.length;
      }
    }
  });
  if (queued) void syncNow(); // uploads now if there is an account; does nothing otherwise
  return result;
}

/* ---------------------------------- wording ---------------------------------- */

const NOUNS: Record<SyncedTable, [string, string]> = {
  prayers: ["prayer", "prayers"],
  journal: ["journal entry", "journal entries"],
  notes: ["note", "notes"],
  highlights: ["highlight", "highlights"],
  memory: ["memory verse", "memory verses"],
  plans: ["reading plan", "reading plans"],
  customPlans: ["custom plan", "custom plans"],
  devotions: ["devotional read", "devotionals read"],
  progress: ["chapter bookmark", "chapter bookmarks"],
  readingLog: ["reading-history entry", "reading-history entries"],
  settings: ["setting", "settings"],
};
/** The order a person cares about: the heart of the app first. */
const ORDER: SyncedTable[] = [
  "prayers", "journal", "notes", "highlights", "memory", "plans", "customPlans", "devotions", "progress", "readingLog", "settings",
];

export const countOf = (t: SyncedTable, n: number) => `${n.toLocaleString()} ${NOUNS[t][n === 1 ? 0 : 1]}`;

/** "142 prayers, 30 journal entries, 12 notes" — every non-empty table in the file. */
export function describeContents(plan: RestorePlan): string {
  const parts = ORDER.filter((t) => (plan.tables[t]?.inFile ?? 0) > 0).map((t) => countOf(t, plan.tables[t]!.inFile));
  return parts.length ? parts.join(", ") : "nothing";
}

/** One or two plain sentences on what pressing Restore will do. */
export function describeEffect(plan: RestorePlan): string[] {
  const { add, update, keep, same } = plan.totals;
  const lines: string[] = [];
  if (add + update === 0) {
    lines.push("Everything in this backup is already on this device. Restoring would change nothing.");
  } else {
    const bits: string[] = [];
    if (add) bits.push(`${add.toLocaleString()} ${add === 1 ? "item is" : "items are"} new here and will be added`);
    if (update) bits.push(`${update.toLocaleString()} will be brought up to date from the backup`);
    lines.push(`${bits.join("; ")}.`);
  }
  if (keep) lines.push(`${keep.toLocaleString()} ${keep === 1 ? "is" : "are"} newer on this device and will be kept.`);
  if (same && add + update > 0) lines.push(`${same.toLocaleString()} ${same === 1 ? "is" : "are"} already here.`);
  return lines;
}

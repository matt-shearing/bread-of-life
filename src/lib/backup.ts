/**
 * Back up every piece of user data to one JSON file, and restore it again.
 *
 * Without sync, the phone is the only copy of years of prayers and journal entries.
 * This is the belt to sync's braces: a file you can keep anywhere, that restores
 * onto any device running the app.
 *
 * What is in a backup: exactly the tables that sync (SYNCED_TABLES in src/db/sync.ts) —
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
import { db } from "@/db";
import { importRows, SYNCED_KEY_PATH, SYNCED_TABLES, type SyncedTable } from "@/db/sync";
import { localDayKey } from "@/lib/day";

export const BACKUP_APP = "bread-of-life";
export const BACKUP_FORMAT = 1;

/**
 * Settings that describe THIS device rather than its owner, so they are left out of a
 * backup and ignored in one: a Missler library path is a folder on one particular
 * disk, and pointing another device at it would switch the feature on and break it.
 */
export const DEVICE_LOCAL_SETTINGS: ReadonlySet<string> = new Set(["misslerLibraryPath"]);

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

const isSetting = (t: SyncedTable) => t === "settings";
const isDeviceLocal = (t: SyncedTable, row: Row) =>
  isSetting(t) && typeof row.key === "string" && DEVICE_LOCAL_SETTINGS.has(row.key);

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
 * When a row was last changed. `updatedAt` is stamped on every write by the sync hooks;
 * rows written before those hooks existed lack it, so fall back to the newest
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
 * What restoring `incoming` over `local` should do:
 *  - add:    nothing local with this key.
 *  - same:   identical already; nothing to write.
 *  - update: the backup's copy is strictly newer.
 *  - keep:   the local copy is newer (or as new) and differs; it stays.
 */
export function decide(table: SyncedTable, local: Row | undefined, incoming: Row): Decision {
  if (!local) return "add";
  if (canonical(local) === canonical(incoming)) return "same";
  return rowStamp(table, incoming) > rowStamp(table, local) ? "update" : "keep";
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
      tally[decide(t, locals[i], r)]++;
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
 * Apply a restore. The decisions are made again inside the write transaction, so an
 * edit made while the preview was open is still respected. Written rows keep their
 * own `updatedAt` and are queued for upload (see importRows in src/db/sync.ts).
 */
export async function applyRestore(parsed: ParsedBackup): Promise<RestoreResult> {
  const result: RestoreResult = { added: 0, updated: 0, kept: 0, unchanged: 0 };
  await importRows(async () => {
    const written: { table: SyncedTable; id: string }[] = [];
    for (const t of SYNCED_TABLES) {
      const rows = importable(t, parsed.backup.tables[t]);
      if (!rows.length) continue;
      const keyPath = SYNCED_KEY_PATH[t];
      const table = db.table(t);
      const ids = rows.map((r) => r[keyPath] as string);
      const locals = (await table.bulkGet(ids)) as (Row | undefined)[];
      const toPut: Row[] = [];
      rows.forEach((r, i) => {
        const d = decide(t, locals[i], r);
        if (d === "add" || d === "update") {
          toPut.push(r);
          written.push({ table: t, id: ids[i] });
          if (d === "add") result.added++;
          else result.updated++;
        } else if (d === "keep") result.kept++;
        else result.unchanged++;
      });
      if (toPut.length) await table.bulkPut(toPut);
    }
    return written;
  });
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
  settings: ["setting", "settings"],
};
/** The order a person cares about: the heart of the app first. */
const ORDER: SyncedTable[] = ["prayers", "journal", "notes", "highlights", "memory", "plans", "customPlans", "devotions", "progress", "settings"];

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

/**
 * What syncs, in one place. Imported by the Dexie setup (src/db/index.ts), the
 * change-tracking middleware (src/db/syncTracking.ts) and the engine (src/db/sync.ts).
 * No imports, so every one of them can use it without a cycle.
 */

export const SYNCED_TABLES = [
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
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export const KEY_PATH: Record<SyncedTable, string> = {
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

export const isSyncedTable = (t: string): t is SyncedTable => (SYNCED_TABLES as readonly string[]).includes(t);

/**
 * Personal content that is END-TO-END ENCRYPTED before it leaves the device when E2E is
 * on (a data key is present). Only the record payload is encrypted; the server still
 * keys on the cleartext (table, id, updatedAt) for last-write-wins.
 */
export const ENCRYPTED_TABLES: ReadonlySet<string> = new Set(["journal", "prayers", "notes"]);

/**
 * The `settings` rows that belong to the ACCOUNT and so sync. Everything else in the
 * table stays on the device: the Missler library path (a desktop path means nothing on a
 * phone, and a saved path switches off the phone's own folder probe), and anything added
 * later unless it is listed here on purpose.
 *
 *  - `ui.*`: the account-level preferences mirrored from the UI store (src/store/syncedPrefs.ts).
 *  - `prayers.customCategories`: the user's own prayer categories.
 *  - `e2e.check`: a value encrypted with the account's data key. Its presence tells a
 *    device the account uses encryption, and it lets a typed recovery phrase be checked.
 */
export const SYNCED_SETTING_PREFIXES = ["ui."] as const;
export const SYNCED_SETTING_KEYS: ReadonlySet<string> = new Set(["prayers.customCategories", "e2e.check"]);
export const E2E_CHECK_KEY = "e2e.check";

export function isSyncedSetting(key: unknown): boolean {
  if (typeof key !== "string") return false;
  return SYNCED_SETTING_KEYS.has(key) || SYNCED_SETTING_PREFIXES.some((p) => key.startsWith(p));
}

/** True for a row that should travel: every row of a synced table, except device-local settings. */
export function syncsRow(table: string, id: string): boolean {
  if (!isSyncedTable(table)) return false;
  return table !== "settings" || isSyncedSetting(id);
}

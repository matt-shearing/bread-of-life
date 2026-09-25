/**
 * Account-level preferences — the slice of the UI store that belongs to YOU rather
 * than to the device in your hand.
 *
 * The UI store persists to localStorage, which is per-device by definition. That was
 * fine while it only held chrome, but the *active reading plan* lives there too, so
 * enrolling on the phone left the desktop showing nothing (the `plans` table synced
 * the progress; nothing carried which plan you were actually on).
 *
 * The fix keeps the one-store rule intact: these keys are mirrored into the Dexie
 * `settings` table, which src/db/sync.ts already replicates, and mirrored back into
 * the store when a pull brings a newer value. The store stays the only thing the UI
 * reads.
 *
 * Deliberately NOT synced — things that describe this device, not the account:
 * the theme MODE and its saved sunrise/sunset coordinate (`theme`, `themeLocation`:
 * "dark after sunset" means a different hour on a phone in Brisbane than on a desk
 * in London, and a coordinate is not ours to push at a server), font scale, reading
 * layout, rail open/width, sidebar state, dashboard background, onboarding flags,
 * the current Bible location, the AI config (it holds an API key, which must
 * never leave the device in the clear), and the daily-reading reminder switch and
 * times (`notifyPlan`, `readingReminderSlots`): whether and when to be nagged is a
 * choice per device. Reading COMPLETION does sync (the `plans` table), which is what
 * lets a reading finished on the desktop silence the phone. `ui.notifyPlan` used to be
 * synced; any old row for it is now ignored.
 */
import { liveQuery, type Subscription } from "dexie";
import { db } from "@/db";
import { setSetting } from "@/db/repos";
import { onSyncRound } from "@/db/sync";
import { useUI, type UIState } from "./ui";

/** UI-store key → `settings` row key. The `ui.` prefix namespaces the table. */
const SETTING_KEY = {
  activePlanId: "ui.activePlanId",
  devotionalId: "ui.devotionalId",
  translation: "ui.translation",
  parallel: "ui.parallel",
  commentarySource: "ui.commentarySource",
  notifyPrayers: "ui.notifyPrayers",
  notifyDevotion: "ui.notifyDevotion",
  notifyMemory: "ui.notifyMemory",
  devotionTime: "ui.devotionTime",
  reminderTime: "ui.reminderTime",
  memoryStreak: "ui.memoryStreak",
  memoryLastReviewDay: "ui.memoryLastReviewDay",
} as const;

type SyncedKey = keyof typeof SETTING_KEY;
const KEYS = Object.keys(SETTING_KEY) as SyncedKey[];
const BY_SETTING_KEY = new Map<string, SyncedKey>(KEYS.map((k) => [SETTING_KEY[k], k]));

/** True while a pulled value is being written into the store — stops the store
 *  subscriber echoing it straight back out to the settings table. */
let applying = false;

function readStore(k: SyncedKey): unknown {
  return (useUI.getState() as unknown as Record<string, unknown>)[k];
}

/** Push a batch of `settings` rows into the store, skipping unchanged values. */
function applyRows(rows: { key: string; value: unknown }[]): void {
  const patch: Record<string, unknown> = {};
  for (const row of rows) {
    const k = BY_SETTING_KEY.get(row.key);
    if (!k) continue;
    if (!Object.is(readStore(k), row.value)) patch[k] = row.value;
  }
  if (!Object.keys(patch).length) return;
  applying = true;
  try {
    // setState (not the store's actions) on purpose: a plan arriving from another
    // device must not fire setActivePlan's side effect of switching the daily
    // reminder on — that switch is per device and stays as this device set it.
    useUI.setState(patch as Partial<UIState>);
  } finally {
    applying = false;
  }
}

/**
 * Publish any synced pref the account has never stored — this is what carries a plan
 * chosen before sync existed (or before this account was signed in) up to the server.
 * Runs only after a completed sync round, so the account's own values have already
 * landed and a freshly-installed device adopts them rather than overwriting them with
 * its defaults. Nullish values are skipped: "no plan yet" is the absence of a
 * preference, not a preference worth pushing.
 */
async function seedMissing(): Promise<void> {
  for (const k of KEYS) {
    if (await db.settings.get(SETTING_KEY[k])) continue;
    const value = readStore(k);
    if (value === null || value === undefined) continue;
    await setSetting(SETTING_KEY[k], value);
  }
}

let started = false;
let watcher: Subscription | null = null;
let unsubscribeStore: (() => void) | null = null;
let stopRoundListener: (() => void) | null = null;

/**
 * Wire the store ⇄ settings mirror. Safe to call once at startup; idempotent.
 * The liveQuery fires immediately with whatever is already in Dexie (hydration)
 * and again on every later change, local or pulled.
 */
export function startPrefSync(): void {
  if (started) return;
  started = true;

  watcher = liveQuery(() =>
    db.settings.where("key").startsWith("ui.").toArray(),
  ).subscribe({
    next: (rows) => applyRows(rows),
    error: (e) => console.error("pref sync: settings watch failed", e),
  });

  unsubscribeStore = useUI.subscribe((state, prev) => {
    if (applying) return;
    const s = state as unknown as Record<string, unknown>;
    const p = prev as unknown as Record<string, unknown>;
    for (const k of KEYS) {
      if (Object.is(s[k], p[k])) continue;
      void setSetting(SETTING_KEY[k], s[k]);
    }
  });

  const offRound = onSyncRound(() => {
    offRound(); // first completed round only
    void seedMissing().catch((e) => console.error("pref sync: seed failed", e));
  });
  stopRoundListener = offRound;
}

/** Tear the mirror down (tests / hot reload). */
export function stopPrefSync(): void {
  watcher?.unsubscribe();
  watcher = null;
  unsubscribeStore?.();
  unsubscribeStore = null;
  stopRoundListener?.();
  stopRoundListener = null;
  started = false;
}

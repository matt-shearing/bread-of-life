import { db } from "@/db";
import { isDueToday } from "@/db/repos";
import { localDayKey } from "@/lib/day";
import { getAnyPlan, countVerses } from "@/data/plans";
import { useUI } from "@/store/ui";
import { readingDayKeys, readingStreak } from "@/lib/streak";
import { deepLinkFor, toPluginPayload, type NativeNotification } from "@/lib/notifyPayload";
import {
  READING_DEEP_LINK,
  dueReadingReminders,
  minutesForVerses,
  planReadingReminders,
  type PlannedReminder,
  type ReadingReminderState,
} from "@/lib/readingReminders";

/**
 * Notifications. Two delivery paths:
 *
 * - **Android / iOS app** — real OS notifications via `@tauri-apps/plugin-notification`,
 *   registered as OS *schedules* so they fire when the app is closed. Tapping one opens
 *   the right screen. The daily-reading reminders are one-off notifications over a
 *   rolling window, re-planned whenever state changes (src/lib/readingReminders.ts).
 * - **Desktop app and browser** — the plugin cannot schedule on desktop (it shows the
 *   notification immediately), so the in-app foreground checks below fire reminders
 *   while the app is open, through the plugin on desktop and the Web Notification API
 *   in a browser.
 */

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isAndroid = isTauri && typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
/**
 * Can the OS deliver our scheduled notifications? Only on mobile. The DESKTOP build of
 * tauri-plugin-notification (2.3.x) ignores `schedule` entirely and shows the
 * notification the moment it is sent, so "scheduling" a 2 pm reminder on Linux popped
 * it at launch. On desktop, as in a browser, reminders come from the in-app checks
 * below while the app is open.
 */
export const osSchedulesReminders =
  isTauri && typeof navigator !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

type NotifPlugin = typeof import("@tauri-apps/plugin-notification");
let _plugin: Promise<NotifPlugin> | null = null;
function plugin(): Promise<NotifPlugin> {
  if (!_plugin) _plugin = import("@tauri-apps/plugin-notification");
  return _plugin;
}

/**
 * Stable numeric ids so each repeating reminder can be cancelled/replaced. `plan`
 * (8804) was the single daily reading-plan reminder; the daily-reading reminders
 * (src/lib/readingReminders.ts, ids from READING_ID_BASE) replaced it, and it is only
 * kept here so the old repeating alarm gets cancelled on devices that still have it.
 */
const SCHEDULE_ID = { devotion: 8801, memory: 8802, prayers: 8803, plan: 8804 } as const;
export type ReminderKind = keyof typeof SCHEDULE_ID;
const DEEP_LINK_BY_ID: Record<number, string> = {
  [SCHEDULE_ID.devotion]: "/devotional",
  [SCHEDULE_ID.memory]: "/memory",
  [SCHEDULE_ID.prayers]: "/prayers",
  [SCHEDULE_ID.plan]: READING_DEEP_LINK,
};

/** Ask for notification permission (native plugin in the app, Web API in a browser). */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (isTauri) {
    const p = await plugin();
    if (await p.isPermissionGranted()) return true;
    return (await p.requestPermission()) === "granted";
  }
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}
/** Back-compat alias — existing callers use this name. */
export const enablePrayerNotifications = ensureNotificationPermission;

// Android needs an explicit channel (8+) for notifications to present richly, and an
// action type for the "Go now" button. Both are registered once at startup.
const CHANNEL_ID = "bol-reminders";
const ACTION_TYPE = "bol-open";

let androidReady: Promise<void> | null = null;
/** Create the notification channel + register the "Go now" action (idempotent, Tauri only). */
export function setupNativeNotifications(): Promise<void> {
  if (!isTauri) return Promise.resolve();
  if (!androidReady) {
    androidReady = (async () => {
      const p = await plugin();
      try {
        await p.createChannel({
          id: CHANNEL_ID,
          name: "Reminders",
          description: "Daily reading, devotional, prayer and memory-verse reminders",
          importance: p.Importance.High,
          visibility: p.Visibility.Public,
        });
      } catch {
        /* desktop / unsupported — non-fatal */
      }
      try {
        await p.registerActionTypes([
          { id: ACTION_TYPE, actions: [{ id: "open", title: "Go now", foreground: true }] },
        ]);
      } catch {
        /* non-fatal */
      }
    })();
  }
  return androidReady;
}

/** Options for an immediate native notification: channel, "Go now", expandable text. */
function nativeOptions(o: {
  id?: number;
  title: string;
  body: string;
  largeBody?: string;
  deepLink?: string;
}) {
  return {
    id: o.id,
    title: o.title,
    body: o.body,
    // largeBody drives the EXPANDED (big-text) view on Android — without it, expanding
    // showed an empty shell. summary is the collapsed detail line.
    largeBody: o.largeBody ?? o.body,
    summary: "Bread of Life",
    channelId: CHANNEL_ID,
    actionTypeId: ACTION_TYPE, // adds the "Go now" button
    autoCancel: true, // tapping dismisses it
    extra: o.deepLink ? { deepLink: o.deepLink } : undefined,
  };
}

/** Fire an OS notification NOW (native or web), optionally deep-linking on tap. */
async function sendNow(title: string, body: string, deepLink?: string, largeBody?: string): Promise<void> {
  if (isTauri) {
    const p = await plugin();
    await setupNativeNotifications();
    p.sendNotification(nativeOptions({ title, body, largeBody, deepLink }));
    return;
  }
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

/* -------------------- scheduled reminders (Android / iOS only) ----------------- */

/**
 * How scheduled notifications reach the plugin, and why not `sendNotification`.
 *
 * `sendNotification` goes through the plugin's Rust `notify` command, which drops
 * fields it does not model and never persists the schedule, so every reminder was
 * lost at a reboot until the app was next opened. Its `batch` command goes straight to
 * the Kotlin side, which saves each scheduled notification and re-arms it after a
 * reboot (LocalNotificationRestoreReceiver).
 *
 * What it saves, and what it hands back when a notification is tapped, is the
 * notification's `sourceJson`, a field the plugin never fills in itself. Without it a
 * saved notification is the string "null" and a tap arrives with no notification
 * attached, so the app cannot tell which screen to open. So we set it. It may only contain fields
 * the Kotlin `Notification` class has: the fire and restore paths parse it with a
 * strict Jackson mapper, and an unknown key would throw inside a BroadcastReceiver.
 * That rules out `extra` (Kotlin's JSObject cannot be deserialised from it anyway), so
 * the screen to open is worked out from the notification's id when it is tapped.
 */
async function scheduleNative(list: NativeNotification[]): Promise<void> {
  if (!list.length) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("plugin:notification|batch", { notifications: list.map((n) => toPluginPayload(n, CHANNEL_ID, ACTION_TYPE)) });
}

function parseHHMM(t: string): [number, number] {
  const [hh, mm] = t.split(":").map(Number);
  return [Math.min(23, Math.max(0, hh || 0)), Math.min(59, Math.max(0, mm || 0))];
}

/**
 * (Re)register a DAILY OS notification at a clock time. No-op off mobile.
 *
 * Uses the plugin's calendar-match `interval` schedule (fires whenever the clock reads
 * HH:MM:00 and re-arms itself for the next day). The previous `Schedule.at(next,
 * repeating=true)` looked daily but is not: on Android the plugin repeats it every
 * (first fire − time of scheduling), so a 7 am devotional set at 10 pm came back every
 * nine hours.
 */
export async function scheduleDailyReminder(
  kind: ReminderKind,
  timeHHMM: string,
  title: string,
  body: string,
  largeBody?: string,
): Promise<void> {
  if (!osSchedulesReminders) return;
  const p = await plugin();
  await setupNativeNotifications();
  const id = SCHEDULE_ID[kind];
  await p.cancel([id]).catch(() => {}); // replace any existing schedule for this kind
  if (!(await p.isPermissionGranted())) return;
  const [hour, minute] = parseHHMM(timeHHMM);
  await scheduleNative([
    {
      id,
      title,
      body,
      largeBody: largeBody ?? body,
      schedule: { interval: { interval: { hour, minute, second: 0 }, allowWhileIdle: true } },
    },
  ]);
}

export async function cancelDailyReminder(kind: ReminderKind): Promise<void> {
  if (!osSchedulesReminders) return;
  await (await plugin()).cancel([SCHEDULE_ID[kind]]).catch(() => {});
}

/** The settings needed to (re)build the devotional, memory and prayer schedules. */
export interface ReminderSettings {
  notifyDevotion: boolean;
  devotionTime: string;
  notifyMemory: boolean;
  notifyPrayers: boolean;
  reminderTime: string; // shared clock time for the memory / prayers reminders
}

/**
 * Reconcile the devotional, memory and prayer daily schedules with the settings. Call
 * at app start and whenever a toggle or time changes. No-op off mobile. The reading
 * reminders have their own reconcile (`reconcileReadingReminders`).
 */
export async function syncReminderSchedules(s: ReminderSettings): Promise<void> {
  if (!osSchedulesReminders) return;
  const jobs: Promise<void>[] = [
    s.notifyDevotion
      ? scheduleDailyReminder(
          "devotion",
          s.devotionTime,
          "Time for your devotional",
          "Your Morning & Evening reading is ready.",
          "A few quiet minutes with Spurgeon’s devotional. Tap “Go now” to read today’s portion and mark it done.",
        )
      : cancelDailyReminder("devotion"),
    s.notifyMemory
      ? scheduleDailyReminder(
          "memory",
          s.reminderTime,
          "Hide His word in your heart",
          "Verses are due for review in Memory Lane.",
          "You have memory verses due today. A short review keeps them fresh — tap “Go now” to open Memory Lane.",
        )
      : cancelDailyReminder("memory"),
    s.notifyPrayers
      ? scheduleDailyReminder(
          "prayers",
          s.reminderTime,
          "Time to pray",
          "Lift up today’s prayers.",
          "Bring your requests before God, and look back on the ones He’s already answered. Tap “Go now” to open your prayers.",
        )
      : cancelDailyReminder("prayers"),
    // The old single reading-plan reminder, superseded by the reading reminders.
    cancelDailyReminder("plan"),
  ];
  await Promise.all(jobs);
}

/* ------------------------------ reading reminders ------------------------------ */

/**
 * Everything the reading-reminder planner needs, read from the store and Dexie now.
 * "Today's reading" is the active plan's first unfinished day (plans are self-paced,
 * exactly as the dashboard and /read-today work it out); it counts as done today when
 * any plan day was completed during today's LOCAL day.
 */
export async function readingReminderState(now: number = Date.now()): Promise<ReadingReminderState> {
  const ui = useUI.getState();
  let hasReading = false;
  let doneToday = false;
  let minutes: number | null = null;
  if (ui.activePlanId) {
    const [plan, prog] = await Promise.all([getAnyPlan(ui.activePlanId), db.plans.get(ui.activePlanId)]);
    if (plan) {
      const done = new Set(prog?.completedDays ?? []);
      let day = 0;
      while (day < plan.days.length && done.has(day)) day++;
      hasReading = day < plan.days.length;
      const today = localDayKey(now);
      doneToday = Object.values(prog?.completedAt ?? {}).some((ts) => localDayKey(ts) === today);
      if (hasReading) minutes = minutesForVerses((await countVerses(plan.days[day]).catch(() => null)) ?? 0);
    }
  }
  const progress = await db.progress.toArray();
  const streak = readingStreak(readingDayKeys(progress.map((p) => p.at)), now);
  return {
    now,
    enabled: ui.notifyPlan,
    slots: ui.readingReminderSlots,
    hasReading,
    doneToday,
    streak,
    minutes,
  };
}

/** The last plan applied, for debugging from the console (`__bolReadingReminders`). */
let lastApplied: { at: string; state: ReadingReminderState; schedule: PlannedReminder[] } | null = null;

async function applyReadingReminders(): Promise<void> {
  if (!osSchedulesReminders) return;
  const p = await plugin();
  await setupNativeNotifications();
  const state = await readingReminderState();
  const granted = await p.isPermissionGranted().catch(() => false);
  const plan = planReadingReminders(granted ? state : { ...state, enabled: false });
  await p.cancel([...plan.cancel, SCHEDULE_ID.plan]).catch(() => {});
  await scheduleNative(
    plan.schedule.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      largeBody: r.largeBody,
      schedule: { at: { date: new Date(r.at), repeating: false, allowWhileIdle: true } },
    })),
  );
  lastApplied = { at: new Date().toString(), state, schedule: plan.schedule };
  (window as unknown as Record<string, unknown>).__bolReadingReminders = lastApplied;
}

let reconciling: Promise<void> | null = null;
let reconcileAgain = false;
/**
 * Make the OS's reading reminders match the current state: call on app start, on
 * return to the app, when a reading is completed here or arrives by sync, and when the
 * settings change. Calls that arrive while one is running collapse into one more run.
 * No-op off mobile (see `maybeNotifyReading`).
 */
export function reconcileReadingReminders(): Promise<void> {
  if (!osSchedulesReminders) return Promise.resolve();
  if (reconciling) {
    reconcileAgain = true;
    return reconciling;
  }
  reconciling = (async () => {
    do {
      reconcileAgain = false;
      try {
        await applyReadingReminders();
      } catch (e) {
        console.error("reading reminders: reconcile failed", e);
      }
    } while (reconcileAgain);
  })().finally(() => {
    reconciling = null;
  });
  return reconciling;
}

const READING_SHOWN_KEY = "bol-reading-notified";

/**
 * Desktop app and browser: the OS cannot hold the schedule, so while the app is open
 * this is checked every minute and shows each of today's reminders once, from its time
 * for fifteen minutes, unless today's reading is already done.
 */
export async function maybeNotifyReading(): Promise<void> {
  if (osSchedulesReminders) return;
  if (!isTauri && (typeof Notification === "undefined" || Notification.permission !== "granted")) return;
  const state = await readingReminderState();
  const today = localDayKey(state.now);
  let shown: string[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(READING_SHOWN_KEY) ?? "null") as { day?: string; keys?: string[] } | null;
    if (raw?.day === today && Array.isArray(raw.keys)) shown = raw.keys;
  } catch {
    /* unreadable: start the day afresh */
  }
  const due = dueReadingReminders(state, new Set(shown));
  if (!due.length) return;
  // Several due at once (a slow wake): show only the latest, but mark them all.
  const r = due[due.length - 1];
  try {
    localStorage.setItem(
      READING_SHOWN_KEY,
      JSON.stringify({ day: today, keys: [...shown, ...due.map((d) => `${d.dayKey}#${d.slot}`)] }),
    );
  } catch {
    /* storage blocked: may repeat, never crashes */
  }
  await sendNow(r.title, r.body, r.deepLink, r.largeBody);
}

/* ------------------------------ tap → screen ----------------------------------- */

/** Route a tapped notification (or its "Go now" action) to its screen. Call once at
 *  startup with the router's navigate. Also registers the channel + action type. */
let routingInit = false;
export async function initNotificationRouting(navigate: (path: string) => void): Promise<void> {
  if (!isTauri || routingInit) return;
  routingInit = true;
  try {
    await setupNativeNotifications();
    const p = await plugin();
    // A tap while the app is running (or in the background).
    await p.onAction((payload) => {
      const link = deepLinkFor(payload, DEEP_LINK_BY_ID);
      if (link) navigate(link);
    });
  } catch {
    // onAction isn't supported on every platform — non-fatal.
  }
  // A tap that STARTED the app: the plugin reported it before we were listening, so
  // ask our own plugin for the launch intent's notification (Android only).
  if (isAndroid) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const launch = await invoke<{ id?: number; notification?: string }>("plugin:reminders|launch_notification");
      if (launch && typeof launch.id === "number") {
        const link = deepLinkFor({ id: launch.id, notification: launch.notification }, DEEP_LINK_BY_ID);
        if (link) navigate(link);
      }
    } catch {
      /* older build without the plugin: the app just opens normally */
    }
  }
}

/* --------------------- foreground checks (browser / dev only) ----------------- */
// On Android/iOS the OS schedules above own delivery, so these return early there to
// avoid double-notifying. In a browser and in the DESKTOP app (whose notification
// plugin cannot schedule) they are how reminders arrive while the app is open.

let prayersNotifiedThisSession = false;
let memoryNotifiedThisSession = false;

/** Devotional reminder: at/after the set time each day, fire once (browser only). */
export async function maybeNotifyDevotion(enabled: boolean, timeHHMM: string): Promise<void> {
  if (osSchedulesReminders || !enabled || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const now = new Date();
  const [hh, mm] = timeHHMM.split(":").map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return; // not time yet
  const todayKey = localDayKey();
  if (localStorage.getItem("bol-devotion-notified") === todayKey) return;
  const slot = now.getHours() < 17 ? "m" : "e";
  const md = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const already = await db.devotions.get(`${md}:${slot}`);
  localStorage.setItem("bol-devotion-notified", todayKey);
  if (already) return;
  await sendNow("Bread of Life", "Time for your Morning & Evening devotional.", "/devotional");
}

/** Memory-verse nudge, once/session/day when cards are due (browser only). */
export async function maybeNotifyMemory(enabled: boolean): Promise<void> {
  if (osSchedulesReminders || memoryNotifiedThisSession || !enabled) return;
  memoryNotifiedThisSession = true;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const todayKey = localDayKey();
  if (localStorage.getItem("bol-memory-notified") === todayKey) return;
  const due = await db.memory.where("dueAt").belowOrEqual(Date.now()).count();
  if (due <= 0) return;
  localStorage.setItem("bol-memory-notified", todayKey);
  await sendNow("Bread of Life", `${due} verse${due === 1 ? "" : "s"} to hide in your heart today — visit Memory Lane.`, "/memory");
}

/** Due-prayers nudge, once per launch (browser only). */
export async function maybeNotifyPrayers(enabled: boolean): Promise<void> {
  if (osSchedulesReminders || prayersNotifiedThisSession || !enabled) return;
  prayersNotifiedThisSession = true;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const prayers = await db.prayers.where("status").equals("active").toArray();
  const due = prayers.filter(isDueToday).length;
  if (due > 0) await sendNow("Bread of Life", `You have ${due} prayer${due === 1 ? "" : "s"} to lift up today.`, "/prayers");
}

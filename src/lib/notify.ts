import { db } from "@/db";
import { isDueToday } from "@/db/repos";
import { localDayKey } from "@/lib/day";

/**
 * Notifications. Two delivery paths:
 *
 * - **Native app (Tauri)** — real OS notifications via `@tauri-apps/plugin-notification`,
 *   with DAILY reminders registered as OS *schedules* so they fire even when the app
 *   isn't focused (and, on mobile, when it's fully closed). Tapping one deep-links to
 *   the right screen. This is the primary path; the foreground checks below are skipped.
 * - **Browser (pnpm dev)** — the Web Notification API, fired by the in-app foreground
 *   checks while the tab is open (no OS scheduling available there).
 *
 * NOTE (verify on device): OS-scheduled delivery *while the app is fully closed* is
 * reliable on Android/iOS; on Linux desktop the plugin fires schedules while the app
 * runs but there's no background daemon to fire them when it's quit.
 */

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type NotifPlugin = typeof import("@tauri-apps/plugin-notification");
let _plugin: Promise<NotifPlugin> | null = null;
function plugin(): Promise<NotifPlugin> {
  if (!_plugin) _plugin = import("@tauri-apps/plugin-notification");
  return _plugin;
}

/** Stable numeric ids so each repeating reminder can be cancelled/replaced. */
const SCHEDULE_ID = { devotion: 8801, memory: 8802, prayers: 8803, plan: 8804 } as const;
export type ReminderKind = keyof typeof SCHEDULE_ID;

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

/** Shared native notification options: channel, tappable "Go now", expandable text, deep-link. */
function nativeOptions(o: {
  id?: number;
  title: string;
  body: string;
  largeBody?: string;
  deepLink?: string;
  schedule?: import("@tauri-apps/plugin-notification").Schedule;
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
    schedule: o.schedule,
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

/* ----------------------- scheduled daily reminders (native) ------------------- */

/** The next Date at HH:MM — today if that time is still ahead, otherwise tomorrow. */
function nextAt(timeHHMM: string): Date {
  const [hh, mm] = timeHHMM.split(":").map(Number);
  const d = new Date();
  d.setHours(hh || 0, mm || 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

/** (Re)register a repeating DAILY OS notification at a clock time. No-op in a browser. */
export async function scheduleDailyReminder(
  kind: ReminderKind,
  timeHHMM: string,
  title: string,
  body: string,
  deepLink?: string,
  largeBody?: string,
): Promise<void> {
  if (!isTauri) return;
  const p = await plugin();
  await setupNativeNotifications();
  const id = SCHEDULE_ID[kind];
  await p.cancel([id]).catch(() => {}); // replace any existing schedule for this kind
  if (!(await p.isPermissionGranted())) return;
  p.sendNotification(
    nativeOptions({
      id,
      title,
      body,
      largeBody,
      deepLink,
      schedule: p.Schedule.at(nextAt(timeHHMM), true, true), // repeat daily, allow while idle
    }),
  );
}

export async function cancelDailyReminder(kind: ReminderKind): Promise<void> {
  if (!isTauri) return;
  await (await plugin()).cancel([SCHEDULE_ID[kind]]).catch(() => {});
}

/** The settings needed to (re)build every native daily schedule. */
export interface ReminderSettings {
  notifyDevotion: boolean;
  devotionTime: string;
  notifyMemory: boolean;
  notifyPrayers: boolean;
  notifyPlan: boolean;
  reminderTime: string; // shared clock time for memory / prayers / plan reminders
}

/**
 * Reconcile ALL native daily schedules with the current settings. Call at app start
 * and whenever a reminder toggle or time changes. Safe (no-op) in a browser.
 */
export async function syncReminderSchedules(s: ReminderSettings): Promise<void> {
  if (!isTauri) return;
  const jobs: Promise<void>[] = [
    s.notifyDevotion
      ? scheduleDailyReminder(
          "devotion",
          s.devotionTime,
          "Time for your devotional",
          "Your Morning & Evening reading is ready.",
          "/devotional",
          "A few quiet minutes with Spurgeon’s devotional. Tap “Go now” to read today’s portion and mark it done.",
        )
      : cancelDailyReminder("devotion"),
    s.notifyMemory
      ? scheduleDailyReminder(
          "memory",
          s.reminderTime,
          "Hide His word in your heart",
          "Verses are due for review in Memory Lane.",
          "/memory",
          "You have memory verses due today. A short review keeps them fresh — tap “Go now” to open Memory Lane.",
        )
      : cancelDailyReminder("memory"),
    s.notifyPrayers
      ? scheduleDailyReminder(
          "prayers",
          s.reminderTime,
          "Time to pray",
          "Lift up today’s prayers.",
          "/prayers",
          "Bring your requests before God, and look back on the ones He’s already answered. Tap “Go now” to open your prayers.",
        )
      : cancelDailyReminder("prayers"),
    s.notifyPlan
      ? scheduleDailyReminder(
          "plan",
          s.reminderTime,
          "Today’s reading",
          "Your reading plan is waiting.",
          "/read-today",
          "Pick up today’s portion in the guided reader — right where you left off. Tap “Go now” to begin.",
        )
      : cancelDailyReminder("plan"),
  ];
  await Promise.all(jobs);
}

/** Route a tapped notification (or its "Go now" action) to its screen. Call once at
 *  startup with the router's navigate. Also registers the channel + action type. */
let routingInit = false;
export async function initNotificationRouting(navigate: (path: string) => void): Promise<void> {
  if (!isTauri || routingInit) return;
  routingInit = true;
  try {
    await setupNativeNotifications();
    const p = await plugin();
    // Fires for the "Go now" action button and (on supported platforms) the body tap.
    await p.onAction((n) => {
      const link = (n.extra as Record<string, unknown> | undefined)?.deepLink;
      if (typeof link === "string") navigate(link);
    });
  } catch {
    // onAction isn't supported on every platform — non-fatal.
  }
}

/* --------------------- foreground checks (browser / dev only) ----------------- */
// In the native app the OS schedules above own delivery, so these return early there
// to avoid double-notifying. They keep the browser (pnpm dev) experience working.

let prayersNotifiedThisSession = false;
let memoryNotifiedThisSession = false;

/** Devotional reminder: at/after the set time each day, fire once (browser only). */
export async function maybeNotifyDevotion(enabled: boolean, timeHHMM: string): Promise<void> {
  if (isTauri || !enabled || typeof Notification === "undefined" || Notification.permission !== "granted") return;
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
  if (isTauri || memoryNotifiedThisSession || !enabled) return;
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
  if (isTauri || prayersNotifiedThisSession || !enabled) return;
  prayersNotifiedThisSession = true;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const prayers = await db.prayers.where("status").equals("active").toArray();
  const due = prayers.filter(isDueToday).length;
  if (due > 0) await sendNow("Bread of Life", `You have ${due} prayer${due === 1 ? "" : "s"} to lift up today.`, "/prayers");
}

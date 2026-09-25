import { localDayKey } from "./day.ts";
import type { NativeNotification } from "./notifyPayload.ts";
import {
  READING_WINDOW_DAYS,
  dayNumber,
  firedAlready,
  localAt,
  parseTime,
  sweep,
  type FiredInfo,
} from "./readingReminders.ts";

/**
 * The devotional, memory-verse and prayer reminders: the PURE planning half, applied by
 * notify.ts alongside the reading reminders.
 *
 * Why rolling one-offs and not a repeating schedule: tauri-plugin-notification 2.3.3
 * arms the FIRST alarm of a repeating (`interval`) schedule with
 * setExactAndAllowWhileIdle, but re-arms every later one with a plain setExact. Android
 * holds a plain exact alarm until the phone leaves Doze, so from the second day on the
 * reminder came late unless the app had been opened. A one-off is always armed with
 * allow-while-idle. So, as for the reading reminders, each enabled reminder gets one
 * notification per day over the rolling window, with an id derived from its kind and
 * date, and every reconcile re-plans the window.
 */

export type DailyKind = "devotion" | "memory" | "prayers";
const KIND_INDEX: Record<DailyKind, number> = { devotion: 0, memory: 1, prayers: 2 };
const KINDS = Object.keys(KIND_INDEX) as DailyKind[];

/**
 * Ids are DAILY_ID_BASE + kind * 1000 + (day number mod 1000): clear of the reading
 * reminders (8 810 000 – 8 819 999) and of the old repeating ids, inside a Java int.
 */
export const DAILY_ID_BASE = 8_820_000;
/** The repeating alarms these replaced (8804 was the old single reading reminder). */
export const LEGACY_REPEATING_IDS = [8801, 8802, 8803, 8804];
export const DAILY_DEEP_LINK: Record<DailyKind, string> = {
  devotion: "/devotional",
  memory: "/memory",
  prayers: "/prayers",
};

export function dailyReminderId(kind: DailyKind, dayKey: string): number {
  return DAILY_ID_BASE + KIND_INDEX[kind] * 1000 + (dayNumber(dayKey) % 1000);
}

/** The screen a daily-reminder id opens, or null if it is not one of ours. */
export function dailyDeepLinkForId(id: number): string | null {
  const k = Math.floor((id - DAILY_ID_BASE) / 1000);
  if (id < DAILY_ID_BASE || k < 0 || k >= KINDS.length) return null;
  return DAILY_DEEP_LINK[KINDS[k]];
}

export interface DailyReminder {
  kind: DailyKind;
  enabled: boolean;
  /** Local clock time, "HH:MM". */
  time: string;
  title: string;
  body: string;
  largeBody: string;
}

export interface DailyReminderState extends FiredInfo {
  now: number;
  reminders: DailyReminder[];
  windowDays?: number;
}

export interface PlannedDaily {
  id: number;
  at: number;
  dayKey: string;
  kind: DailyKind;
  title: string;
  body: string;
  largeBody: string;
  deepLink: string;
}

export interface DailyPlan {
  schedule: PlannedDaily[];
  cancel: number[];
  keep: { id: number; at: number }[];
}

export function planDailyReminders(s: DailyReminderState): DailyPlan {
  const window = Math.max(1, s.windowDays ?? READING_WINDOW_DAYS);
  const schedule: PlannedDaily[] = [];
  const keep: { id: number; at: number }[] = [];
  for (const r of s.reminders) {
    const hm = parseTime(r.time);
    if (!r.enabled || !hm) continue;
    for (let offset = 0; offset < window; offset++) {
      const at = localAt(s.now, offset, hm[0], hm[1]).getTime();
      const dayKey = localDayKey(at);
      const id = dailyReminderId(r.kind, dayKey);
      if (at > s.now) {
        schedule.push({ id, at, dayKey, kind: r.kind, title: r.title, body: r.body, largeBody: r.largeBody, deepLink: DAILY_DEEP_LINK[r.kind] });
      } else if (offset === 0 && firedAlready(id, s.now, s)) {
        keep.push({ id, at }); // today's already fired: leave it in the shade
      }
    }
  }
  const cancel = [
    ...LEGACY_REPEATING_IDS,
    ...sweep(s.now, window, schedule, keep, (dayKey) => KINDS.map((k) => dailyReminderId(k, dayKey))),
  ];
  schedule.sort((a, b) => a.at - b.at);
  return { schedule, cancel, keep };
}

/** A planned reminder as the exact, allow-while-idle one-off handed to the plugin. */
export function toNative(r: { id: number; at: number; title: string; body: string; largeBody: string }): NativeNotification {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    largeBody: r.largeBody,
    schedule: { at: { date: new Date(r.at), repeating: false, allowWhileIdle: true } },
  };
}

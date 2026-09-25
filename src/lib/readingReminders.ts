import { localDayKey } from "./day.ts";

/**
 * Daily-reading reminders: the PURE planning half.
 *
 * Given the moment, the reminder settings, whether today's reading is done and the
 * reading streak, `planReadingReminders` returns the exact set of OS notifications
 * that should exist and the ids that must not. `notify.ts` applies it; nothing here
 * touches the plugin, Dexie or the clock, so it is unit-tested directly
 * (scripts/test-reading-reminders.mjs).
 *
 * Why one-off notifications and not a repeating schedule: an OS schedule cannot ask
 * "is today's reading done?" when it fires. So instead of one repeating alarm per time,
 * we schedule separate one-off notifications for each time on each of the next
 * `READING_WINDOW_DAYS` days, each with an id derived from its date and slot. Every
 * reconcile (app start, return to the app, a completed reading, a sync pull) replaces
 * the whole window: finishing today's reading drops today's remaining ones, and the
 * deterministic ids mean re-running it never duplicates anything. If the app is not
 * opened for a while, the window simply runs down; it never piles up.
 *
 * The window is short (today and tomorrow) on purpose. After a reboot the notification
 * plugin's restore receiver re-arms every saved one-off and fires any that fell due
 * while the phone was off, all at once, fifteen seconds after boot. A short window caps
 * that burst at two days' worth. The cost: if the app is not opened for two days the
 * reminders stop until it is. The devotional, memory and prayer reminders use the same
 * window (src/lib/dailyReminders.ts).
 */

export interface ReminderSlot {
  /** Local clock time, "HH:MM". */
  time: string;
  enabled: boolean;
}

export const DEFAULT_READING_SLOTS: ReminderSlot[] = [
  { time: "14:00", enabled: true },
  { time: "20:00", enabled: true },
];
export const MAX_READING_SLOTS = 4;
/** How many days ahead one-offs are scheduled (today included). */
export const READING_WINDOW_DAYS = 2;
/**
 * How far ahead the cancel sweep reaches, whatever the window: builds before the window
 * was shortened scheduled a week ahead, and those alarms must not survive the upgrade.
 */
export const SWEEP_AHEAD_DAYS = 8;
/**
 * Ids are READING_ID_BASE + (day number mod 1000) * 10 + slot, well clear of the
 * other reminders (8801–8804) and inside a Java int.
 */
export const READING_ID_BASE = 8_810_000;
export const READING_DEEP_LINK = "/read-today";

/**
 * What we know about notifications that may already have fired, so a reminder whose
 * time is now past can be told apart from one that was merely moved into the past.
 */
export interface FiredInfo {
  /** Ids the OS is showing right now (the plugin's `active()`), if it could say. */
  delivered?: ReadonlySet<number>;
  /** The last plan applied on this device: everything it scheduled or kept. */
  previous?: ReadonlyArray<{ id: number; at: number }>;
}

/**
 * Did notification `id` already fire? Yes if it is showing, or if the last plan applied
 * had it due at or before `now`. Otherwise its alarm, if any, is still pending.
 */
export function firedAlready(id: number, now: number, info: FiredInfo): boolean {
  if (info.delivered?.has(id)) return true;
  const prev = info.previous?.find((p) => p.id === id);
  return !!prev && prev.at <= now;
}

export interface ReadingReminderState extends FiredInfo {
  now: number;
  /** The master switch for daily-reading reminders on this device. */
  enabled: boolean;
  slots: ReminderSlot[];
  /** There is an active plan with a day still to read. */
  hasReading: boolean;
  /** A plan day was completed during today (local day). */
  doneToday: boolean;
  /** From readingStreak(): the same numbers the dashboard shows. */
  streak: { days: number; includesToday: boolean };
  /** Rough length of the next reading, or null if unknown. */
  minutes: number | null;
  windowDays?: number;
}

export interface PlannedReminder {
  id: number;
  /** Epoch ms of the local clock time it fires at. */
  at: number;
  dayKey: string;
  slot: number;
  title: string;
  body: string;
  largeBody: string;
  deepLink: string;
}

export interface ReminderPlan {
  /** Notifications that should be scheduled (all in the future). */
  schedule: PlannedReminder[];
  /** Ids that must not exist: cancel them (this also clears one from the shade). */
  cancel: number[];
  /** Today's reminders that already fired and are left alone (in the shade). */
  keep: { id: number; at: number }[];
}

/** "HH:MM" → [hours, minutes], or null if it is not a valid clock time. */
export function parseTime(t: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return [h, min];
}

/** Whole days since 1970-01-01 for a "YYYY-MM-DD" key. Calendar arithmetic only. */
export function dayNumber(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function reminderId(dayKey: string, slot: number): number {
  return READING_ID_BASE + (dayNumber(dayKey) % 1000) * 10 + slot;
}

/** Local midnight-based date `offset` days from `now`, at hh:mm (DST-safe). */
export function localAt(now: number, offset: number, hh: number, mm: number): Date {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, hh, mm, 0, 0);
}

/**
 * Minutes to read (or listen to) a number of verses. BSB verses average about 25
 * words and the narration runs near 170 words a minute, so roughly 7 verses a minute.
 */
export function minutesForVerses(verses: number): number | null {
  if (!Number.isFinite(verses) || verses <= 0) return null;
  return Math.max(1, Math.round(verses / 7));
}

function reminderText(opts: {
  streakDays: number | null;
  minutes: number | null;
  laterInDay: boolean;
}): { title: string; body: string; largeBody: string } {
  const { streakDays, minutes, laterInDay } = opts;
  const length = minutes ? `Today’s reading takes about ${minutes} minute${minutes === 1 ? "" : "s"}.` : null;
  let title: string;
  let body: string;
  if (streakDays && streakDays >= 2) {
    title = `Keep your ${streakDays}-day streak going`;
    body = [`You’re on a ${streakDays}-day streak.`, length].filter(Boolean).join(" ");
  } else {
    title = laterInDay ? "There’s still time for today’s reading" : "Today’s reading";
    body = length ?? "Your reading plan is waiting.";
  }
  return { title, body, largeBody: `${body} Tap to open today’s reading.` };
}

/** All enabled reminders for the day `offset` days from now, past or future. */
function remindersForDay(s: ReadingReminderState, offset: number): PlannedReminder[] {
  const enabled = s.slots
    .map((slot, index) => ({ slot, index, hm: parseTime(slot.time) }))
    .filter((x) => x.slot.enabled && x.hm && x.index < MAX_READING_SLOTS)
    .sort((a, b) => a.hm![0] * 60 + a.hm![1] - (b.hm![0] * 60 + b.hm![1]));

  // The streak line is only true if we know the streak runs up to the day before the
  // reminder. Today: it does (alive through yesterday, or through today). Tomorrow:
  // only if today already counts. Further out we cannot know, so leave it out.
  let streakDays: number | null = null;
  if (offset === 0) streakDays = s.streak.days;
  else if (offset === 1 && s.streak.includesToday) streakDays = s.streak.days;

  return enabled.map((x, order) => {
    const at = localAt(s.now, offset, x.hm![0], x.hm![1]);
    const dayKey = localDayKey(at.getTime());
    return {
      id: reminderId(dayKey, x.index),
      at: at.getTime(),
      dayKey,
      slot: x.index,
      deepLink: READING_DEEP_LINK,
      ...reminderText({ streakDays, minutes: s.minutes, laterInDay: order > 0 }),
    };
  });
}

function active(s: ReadingReminderState): boolean {
  return s.enabled && s.hasReading && s.slots.some((x) => x.enabled && parseTime(x.time));
}

export function planReadingReminders(s: ReadingReminderState): ReminderPlan {
  const window = Math.max(1, s.windowDays ?? READING_WINDOW_DAYS);
  const schedule: PlannedReminder[] = [];
  const keep: { id: number; at: number }[] = [];

  if (active(s)) {
    for (let offset = 0; offset < window; offset++) {
      for (const r of remindersForDay(s, offset)) {
        if (r.at > s.now) {
          if (offset === 0 && s.doneToday) continue; // done: nothing more today
          schedule.push(r);
        } else if (offset === 0 && !s.doneToday && firedAlready(r.id, s.now, s)) {
          // Already fired today and the reading is still not done: leave it in the
          // notification shade rather than cancelling (which would clear it). A time
          // that is past only because the slot was just moved earlier has NOT fired:
          // its old alarm is still set for the old time, so it falls through to cancel.
          keep.push({ id: r.id, at: r.at });
        }
      }
    }
  }

  const cancel = sweep(s.now, window, schedule, keep, (dayKey) =>
    Array.from({ length: MAX_READING_SLOTS }, (_, slot) => reminderId(dayKey, slot)),
  );
  schedule.sort((a, b) => a.at - b.at);
  return { schedule, cancel, keep };
}

/**
 * Every id a feature could have used from two days back to past the end of the window
 * (and never less than SWEEP_AHEAD_DAYS ahead), minus the ones wanted or kept. So a
 * shortened window, a removed slot or a changed setting leaves nothing behind, and
 * yesterday's still sitting in the shade goes too.
 */
export function sweep(
  now: number,
  window: number,
  schedule: ReadonlyArray<{ id: number }>,
  keep: ReadonlyArray<{ id: number }>,
  idsForDay: (dayKey: string) => number[],
): number[] {
  const leave = new Set([...schedule, ...keep].map((r) => r.id));
  const cancel: number[] = [];
  for (let offset = -2; offset <= Math.max(window + 1, SWEEP_AHEAD_DAYS); offset++) {
    const dayKey = localDayKey(localAt(now, offset, 12, 0).getTime());
    for (const id of idsForDay(dayKey)) if (!leave.has(id)) cancel.push(id);
  }
  return cancel;
}

/**
 * Persisted-UI migration (store/ui.ts, `bol-ui` version 0 → 1). Before v0.4 the single
 * reading-plan reminder fired at `reminderTime` (shared with memory and prayers); v0.4
 * replaced it with reminder slots defaulting to 2 pm and 8 pm. Without this, an upgrade
 * silently moved a user's chosen time. If the reading reminder was on, their time
 * becomes the first slot and 8 pm stays as the second (unless it was 8 pm already).
 */
export function migrateReminderPrefs(persisted: Record<string, unknown>, version: number): Record<string, unknown> {
  if (version >= 1 || !persisted || typeof persisted !== "object") return persisted;
  if (Array.isArray(persisted.readingReminderSlots) || persisted.notifyPlan !== true) return persisted;
  const hm = typeof persisted.reminderTime === "string" ? parseTime(persisted.reminderTime) : null;
  if (!hm) return persisted;
  const time = `${String(hm[0]).padStart(2, "0")}:${String(hm[1]).padStart(2, "0")}`;
  const slots: ReminderSlot[] = [{ time, enabled: true }];
  if (time !== "20:00") slots.push({ time: "20:00", enabled: true });
  return { ...persisted, readingReminderSlots: slots };
}

/**
 * The in-app fallback where the OS cannot schedule (desktop app, browser): which of
 * today's reminders are due now. A reminder is due from its time for `graceMs`, once
 * (the caller records `${dayKey}#${slot}` in `alreadyShown`), and never once today's
 * reading is done.
 */
export function dueReadingReminders(
  s: ReadingReminderState,
  alreadyShown: ReadonlySet<string>,
  graceMs = 15 * 60_000,
): PlannedReminder[] {
  if (!active(s) || s.doneToday) return [];
  return remindersForDay(s, 0).filter(
    (r) => r.at <= s.now && s.now - r.at < graceMs && !alreadyShown.has(`${r.dayKey}#${r.slot}`),
  );
}

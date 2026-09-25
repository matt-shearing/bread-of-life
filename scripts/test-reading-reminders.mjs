/**
 * Unit tests for the daily-reading reminder planner (src/lib/readingReminders.ts) and
 * the shared reading streak (src/lib/streak.ts).
 *
 * Run: pnpm test:reminders   (or: node scripts/test-reading-reminders.mjs)
 *
 * Needs Node 23.6+ (imports the TypeScript sources directly; Node strips the types).
 * Runs itself twice, in Perth (UTC+8, no daylight saving: Matt's zone, where a UTC date
 * is wrong every morning before 8 am) and in New York (to cross a daylight-saving
 * change).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const ZONES = ["Australia/Perth", "America/New_York"];

if (!process.env.BOL_TEST_TZ) {
  let failed = false;
  for (const tz of ZONES) {
    console.log(`\n=== TZ=${tz}`);
    const r = spawnSync(process.execPath, ["--test-reporter=spec", fileURLToPath(import.meta.url)], {
      stdio: "inherit",
      env: { ...process.env, TZ: tz, BOL_TEST_TZ: tz },
    });
    if (r.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

const TZ = process.env.BOL_TEST_TZ;
const {
  planReadingReminders,
  dueReadingReminders,
  reminderId,
  minutesForVerses,
  DEFAULT_READING_SLOTS,
  READING_ID_BASE,
  READING_WINDOW_DAYS,
  MAX_READING_SLOTS,
} = await import("../src/lib/readingReminders.ts");
const { readingStreak, readingDayKeys } = await import("../src/lib/streak.ts");
const { localDayKey } = await import("../src/lib/day.ts");

/** Local wall-clock time → epoch ms (month is 1-based). */
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const hhmm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function state(over = {}) {
  return {
    now: at(2026, 9, 25, 10, 0),
    enabled: true,
    slots: DEFAULT_READING_SLOTS,
    hasReading: true,
    doneToday: false,
    streak: { days: 12, includesToday: false },
    minutes: 15,
    ...over,
  };
}

test(`[${TZ}] morning, not done: today's 2 pm and 8 pm plus the rest of the window`, () => {
  const { schedule, cancel } = planReadingReminders(state());
  assert.equal(schedule.length, 2 * READING_WINDOW_DAYS);
  assert.deepEqual(
    schedule.slice(0, 4).map((r) => `${r.dayKey} ${hhmm(r.at)}`),
    ["2026-09-25 14:00", "2026-09-25 20:00", "2026-09-26 14:00", "2026-09-26 20:00"],
  );
  // Every one is in the future, opens today's reading, and has its own id.
  assert.ok(schedule.every((r) => r.at > state().now && r.deepLink === "/read-today"));
  assert.equal(new Set(schedule.map((r) => r.id)).size, schedule.length);
  // Nothing scheduled is also cancelled.
  const ids = new Set(schedule.map((r) => r.id));
  assert.ok(cancel.every((id) => !ids.has(id)));
});

test(`[${TZ}] streak text: today mentions the streak and the length`, () => {
  const [first, second] = planReadingReminders(state()).schedule;
  assert.equal(first.title, "Keep your 12-day streak going");
  assert.equal(first.body, "You’re on a 12-day streak. Today’s reading takes about 15 minutes.");
  assert.equal(second.title, "Keep your 12-day streak going");
  assert.match(first.largeBody, /Tap to open today’s reading\.$/);
});

test(`[${TZ}] streak text is left out where it might not be true`, () => {
  const { schedule } = planReadingReminders(state());
  // Tomorrow: today is not read yet, so tomorrow's streak is unknown.
  const tomorrow = schedule.filter((r) => r.dayKey === "2026-09-26");
  assert.equal(tomorrow[0].title, "Today’s reading");
  assert.equal(tomorrow[0].body, "Today’s reading takes about 15 minutes.");
  assert.equal(tomorrow[1].title, "There’s still time for today’s reading");
});

test(`[${TZ}] a streak of one day is not mentioned; no estimate means no length`, () => {
  const [r] = planReadingReminders(state({ streak: { days: 1, includesToday: false }, minutes: null })).schedule;
  assert.equal(r.title, "Today’s reading");
  assert.equal(r.body, "Your reading plan is waiting.");
  const [s] = planReadingReminders(state({ minutes: null })).schedule;
  assert.equal(s.body, "You’re on a 12-day streak.");
  const [one] = planReadingReminders(state({ streak: { days: 0, includesToday: false }, minutes: 1 })).schedule;
  assert.equal(one.body, "Today’s reading takes about 1 minute.");
});

test(`[${TZ}] after 2 pm, not done: the 2 pm one is left in the shade, 8 pm still comes`, () => {
  const two = reminderId("2026-09-25", 0);
  const s = state({ now: at(2026, 9, 25, 15, 0), delivered: new Set([two]) });
  const { schedule, cancel } = planReadingReminders(s);
  const eight = reminderId("2026-09-25", 1);
  assert.equal(`${schedule[0].dayKey} ${hhmm(schedule[0].at)}`, "2026-09-25 20:00");
  assert.equal(schedule[0].id, eight);
  assert.ok(!schedule.some((r) => r.id === two), "2 pm is in the past, not rescheduled");
  assert.ok(!cancel.includes(two), "2 pm must not be cancelled (that would clear it from the shade)");
});

test(`[${TZ}] reading done at 3 pm: today's remaining reminder is cancelled, tomorrow's carry the streak`, () => {
  const s = state({ now: at(2026, 9, 25, 15, 0), doneToday: true, streak: { days: 13, includesToday: true } });
  const { schedule, cancel } = planReadingReminders(s);
  assert.ok(!schedule.some((r) => r.dayKey === "2026-09-25"), "nothing more today");
  assert.ok(cancel.includes(reminderId("2026-09-25", 0)));
  assert.ok(cancel.includes(reminderId("2026-09-25", 1)));
  const tomorrow = schedule.filter((r) => r.dayKey === "2026-09-26");
  assert.deepEqual(tomorrow.map((r) => hhmm(r.at)), ["14:00", "20:00"]);
  assert.equal(tomorrow[0].title, "Keep your 13-day streak going");
  // Two days out, the streak is not known: no streak line.
  const later = planReadingReminders({ ...s, windowDays: 3 }).schedule.find((r) => r.dayKey === "2026-09-27");
  assert.equal(later.title, "Today’s reading");
  assert.equal(schedule.length, 2 * (READING_WINDOW_DAYS - 1));
});

test(`[${TZ}] done in the morning before any reminder: no reminders today at all`, () => {
  const s = state({ now: at(2026, 9, 25, 7, 30), doneToday: true, streak: { days: 5, includesToday: true } });
  const { schedule } = planReadingReminders(s);
  assert.equal(schedule[0].dayKey, "2026-09-26");
});

test(`[${TZ}] after 8 pm, not done: nothing new today, both of today's kept`, () => {
  const s = state({ now: at(2026, 9, 25, 21, 0), delivered: new Set([reminderId("2026-09-25", 0), reminderId("2026-09-25", 1)]) });
  const { schedule, cancel } = planReadingReminders(s);
  assert.equal(schedule[0].dayKey, "2026-09-26");
  assert.ok(!cancel.includes(reminderId("2026-09-25", 0)));
  assert.ok(!cancel.includes(reminderId("2026-09-25", 1)));
});

test(`[${TZ}] switched off, no plan, or plan finished: nothing scheduled, everything cancelled`, () => {
  for (const over of [{ enabled: false }, { hasReading: false }, { slots: [] }]) {
    const { schedule, cancel } = planReadingReminders(state(over));
    assert.equal(schedule.length, 0, JSON.stringify(over));
    for (let d = 25; d <= 30; d++) {
      for (let slot = 0; slot < MAX_READING_SLOTS; slot++) {
        assert.ok(cancel.includes(reminderId(`2026-09-${d}`, slot)), `${d}/${slot} ${JSON.stringify(over)}`);
      }
    }
  }
});

test(`[${TZ}] a slot switched off is not scheduled and its old ones are cancelled`, () => {
  const slots = [
    { time: "14:00", enabled: false },
    { time: "20:00", enabled: true },
  ];
  const { schedule, cancel } = planReadingReminders(state({ slots }));
  assert.ok(schedule.every((r) => r.slot === 1 && hhmm(r.at) === "20:00"));
  assert.equal(schedule.length, READING_WINDOW_DAYS);
  assert.ok(cancel.includes(reminderId("2026-09-25", 0)));
  // With 2 pm off, 8 pm is the day's FIRST reminder, so it gets the plain title.
  const plain = planReadingReminders(state({ slots, streak: { days: 0, includesToday: false } })).schedule[0];
  assert.equal(plain.title, "Today’s reading");
});

test(`[${TZ}] custom times, out of order and edited, and invalid ones ignored`, () => {
  const slots = [
    { time: "21:30", enabled: true },
    { time: "06:45", enabled: true },
    { time: "25:00", enabled: true },
    { time: "", enabled: true },
  ];
  const { schedule } = planReadingReminders(state({ now: at(2026, 9, 25, 5, 0), slots }));
  const today = schedule.filter((r) => r.dayKey === "2026-09-25");
  assert.deepEqual(today.map((r) => [hhmm(r.at), r.slot]), [["06:45", 1], ["21:30", 0]]);
  assert.equal(today[1].title, "Keep your 12-day streak going");
});

test(`[${TZ}] the same moment always yields the same plan (safe to reconcile repeatedly)`, () => {
  const a = planReadingReminders(state());
  const b = planReadingReminders(state());
  assert.deepEqual(a, b);
  // A few minutes later the same notifications have the same ids.
  const c = planReadingReminders(state({ now: state().now + 5 * 60_000 }));
  assert.deepEqual(c.schedule.map((r) => r.id), a.schedule.map((r) => r.id));
});

test(`[${TZ}] ids: deterministic, unique over a year, inside a Java int, clear of 8801-8804`, () => {
  const seen = new Set();
  for (let i = 0; i < 366; i++) {
    const key = localDayKey(at(2026, 1, 1, 12) + i * 86_400_000);
    for (let slot = 0; slot < MAX_READING_SLOTS; slot++) {
      const id = reminderId(key, slot);
      assert.ok(!seen.has(id), `duplicate ${id}`);
      seen.add(id);
      assert.ok(id >= READING_ID_BASE && id < READING_ID_BASE + 10_000 && id < 2 ** 31);
    }
  }
  assert.equal(reminderId("2026-09-25", 1), reminderId("2026-09-25", 1));
});

test(`[${TZ}] reminders are at LOCAL clock times on LOCAL days`, () => {
  // 07:30 local. In Perth that is 23:30 UTC the day before: a UTC date would say "the 24th".
  const s = state({ now: at(2026, 9, 25, 7, 30) });
  const [first] = planReadingReminders(s).schedule;
  assert.equal(first.dayKey, "2026-09-25");
  assert.equal(first.at, at(2026, 9, 25, 14, 0));
  if (TZ === "Australia/Perth") assert.equal(new Date(first.at).toISOString(), "2026-09-25T06:00:00.000Z");
});

test(`[${TZ}] across a daylight-saving change the reminders keep their clock time`, () => {
  // New York leaves daylight saving on 1 Nov 2026; Perth has none. Either way: 14:00 and 20:00.
  const s = state({ now: at(2026, 10, 30, 9, 0), windowDays: 7 });
  const { schedule } = planReadingReminders(s);
  assert.ok(schedule.every((r) => ["14:00", "20:00"].includes(hhmm(r.at))));
  assert.deepEqual(
    [...new Set(schedule.map((r) => r.dayKey))],
    ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"],
  );
});

test(`[${TZ}] desktop/browser fallback: due from its time for 15 minutes, once, never when done`, () => {
  const s = state({ now: at(2026, 9, 25, 14, 5) });
  const due = dueReadingReminders(s, new Set());
  assert.equal(due.length, 1);
  assert.equal(hhmm(due[0].at), "14:00");
  assert.equal(dueReadingReminders(s, new Set(["2026-09-25#0"])).length, 0, "already shown");
  assert.equal(dueReadingReminders(state({ now: at(2026, 9, 25, 14, 20) }), new Set()).length, 0, "too late");
  assert.equal(dueReadingReminders(state({ now: at(2026, 9, 25, 13, 59) }), new Set()).length, 0, "too early");
  assert.equal(dueReadingReminders({ ...s, doneToday: true }, new Set()).length, 0, "done");
  assert.equal(dueReadingReminders({ ...s, enabled: false }, new Set()).length, 0, "off");
});

test(`[${TZ}] minutes estimate`, () => {
  assert.equal(minutesForVerses(105), 15);
  assert.equal(minutesForVerses(3), 1);
  assert.equal(minutesForVerses(0), null);
});

test(`[${TZ}] reading streak (shared with the dashboard) counts local days`, () => {
  const now = at(2026, 9, 25, 10, 0);
  const days = (...ts) => readingDayKeys(ts);
  // Read yesterday and the day before, not yet today: the streak is alive at 2.
  assert.deepEqual(readingStreak(days(at(2026, 9, 24, 21), at(2026, 9, 23, 8)), now), { days: 2, includesToday: false });
  // Read today as well: 3, including today.
  assert.deepEqual(
    readingStreak(days(at(2026, 9, 25, 6), at(2026, 9, 24, 21), at(2026, 9, 23, 8)), now),
    { days: 3, includesToday: true },
  );
  // A missed day breaks it.
  assert.deepEqual(readingStreak(days(at(2026, 9, 25, 6), at(2026, 9, 23, 8)), now), { days: 1, includesToday: true });
  // Last read two days ago: no streak.
  assert.deepEqual(readingStreak(days(at(2026, 9, 23, 8)), now), { days: 0, includesToday: false });
  // Early-morning reads count for the local day they happened on (07:00 in Perth is
  // 23:00 UTC the previous day).
  assert.deepEqual(
    readingStreak(days(at(2026, 9, 25, 7), at(2026, 9, 24, 7), at(2026, 9, 23, 7)), now),
    { days: 3, includesToday: true },
  );
  // Across the New York daylight-saving change.
  assert.deepEqual(
    readingStreak(days(at(2026, 11, 2, 9), at(2026, 11, 1, 9), at(2026, 10, 31, 9)), at(2026, 11, 2, 20)),
    { days: 3, includesToday: true },
  );
});

/* ---- the payload handed to the Android plugin, and tap routing ---- */
const { toPluginPayload, deepLinkFor } = await import("../src/lib/notifyPayload.ts");

// Bean properties of tauri-plugin-notification 2.3.3's Kotlin classes. The plugin's
// alarm and reboot receivers parse the saved JSON with a STRICT Jackson mapper, so a
// key outside these would throw inside a BroadcastReceiver and lose the reminder.
const KOTLIN_NOTIFICATION = new Set(
  "id title body largeBody summary sound icon largeIcon iconColor actionTypeId group inboxLines groupSummary ongoing autoCancel extra attachments schedule channelId sourceJson visibility number".split(" "),
);
const KOTLIN_AT = new Set(["date", "repeating", "allowWhileIdle"]);
const KOTLIN_INTERVAL = new Set(["interval", "allowWhileIdle"]);
const KOTLIN_DATEMATCH = new Set(["year", "month", "day", "weekday", "hour", "minute", "second", "unit"]);

function checkStrictShape(obj, where) {
  for (const k of Object.keys(obj)) assert.ok(KOTLIN_NOTIFICATION.has(k), `${where}: unknown key ${k}`);
  assert.ok(!("extra" in obj), `${where}: extra cannot be deserialised by the plugin`);
  const s = obj.schedule;
  if (s.at) for (const k of Object.keys(s.at)) assert.ok(KOTLIN_AT.has(k), `${where}: at.${k}`);
  if (s.interval) {
    for (const k of Object.keys(s.interval)) assert.ok(KOTLIN_INTERVAL.has(k), `${where}: interval.${k}`);
    for (const k of Object.keys(s.interval.interval)) assert.ok(KOTLIN_DATEMATCH.has(k), `${where}: match.${k}`);
  }
}

test(`[${TZ}] plugin payload: only fields the Kotlin side knows, and it carries itself`, () => {
  const [r] = planReadingReminders(state()).schedule;
  const p = toPluginPayload(
    { id: r.id, title: r.title, body: r.body, largeBody: r.largeBody, schedule: { at: { date: new Date(r.at), repeating: false, allowWhileIdle: true } } },
    "bol-reminders",
    "bol-open",
  );
  // What the IPC sends is the JSON of this object.
  const sent = JSON.parse(JSON.stringify(p));
  checkStrictShape(sent, "sent");
  // The date is in the exact form Kotlin's JS_DATE_FORMAT parses (UTC, milliseconds).
  assert.match(sent.schedule.at.date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(new Date(sent.schedule.at.date).getTime(), r.at);
  // sourceJson is what gets saved (and restored after a reboot)...
  const saved = JSON.parse(sent.sourceJson);
  checkStrictShape(saved, "saved");
  assert.equal(saved.id, r.id);
  // ...and after a restore its own sourceJson still names the notification for the tap.
  const restored = JSON.parse(saved.sourceJson);
  checkStrictShape(restored, "restored");
  assert.equal(restored.id, r.id);
  assert.equal(sent.autoCancel, true);

  const daily = JSON.parse(
    JSON.stringify(
      toPluginPayload(
        { id: 8801, title: "t", body: "b", largeBody: "b", schedule: { interval: { interval: { hour: 7, minute: 0, second: 0 }, allowWhileIdle: true } } },
        "bol-reminders",
        "bol-open",
      ),
    ),
  );
  checkStrictShape(daily, "daily");
  checkStrictShape(JSON.parse(daily.sourceJson), "daily saved");
});

test(`[${TZ}] a tap opens the right screen, warm or cold, reading or older reminder`, () => {
  const byId = { 8801: "/devotional", 8802: "/memory", 8803: "/prayers", 8804: "/read-today" };
  const id = reminderId("2026-09-25", 1);
  const [r] = planReadingReminders(state()).schedule;
  const sent = toPluginPayload(
    { id, title: r.title, body: r.body, largeBody: r.largeBody, schedule: { at: { date: new Date(r.at), repeating: false, allowWhileIdle: true } } },
    "c",
    "a",
  );
  // Warm: actionPerformed carries the notification parsed from sourceJson.
  assert.equal(deepLinkFor({ actionId: "tap", notification: JSON.parse(sent.sourceJson) }, byId), "/read-today");
  // Cold: our launch_notification returns the raw JSON string.
  assert.equal(deepLinkFor({ id, notification: sent.sourceJson }, byId), "/read-today");
  // Cold with no JSON (restored twice): the id alone is enough.
  assert.equal(deepLinkFor({ id }, byId), "/read-today");
  assert.equal(deepLinkFor({ id: 8801 }, byId), "/devotional");
  assert.equal(deepLinkFor({ notification: { id: 8803 } }, byId), "/prayers");
  // A web notification object with an explicit deep link still works.
  assert.equal(deepLinkFor({ extra: { deepLink: "/memory" } }, byId), "/memory");
  assert.equal(deepLinkFor({ actionId: "tap", notification: null }, byId), null);
  assert.equal(deepLinkFor({ id: 42 }, byId), null);
});

/* ---- review fixes (2026-09-25): stale alarms, repeating reminders, upgrade, reboot ---- */
const rr = await import("../src/lib/readingReminders.ts");
let daily = null;
try {
  daily = await import("../src/lib/dailyReminders.ts");
} catch {
  /* missing before the fix: the tests below fail on it */
}
/** What notify.ts records after applying a plan: everything scheduled or kept. */
const applied = (plan) => [...plan.schedule, ...(plan.keep ?? [])].map((r) => ({ id: r.id, at: r.at }));

test(`[${TZ}] moving a slot to a time already past today cancels its old alarm`, () => {
  const now = at(2026, 9, 25, 15, 0);
  const two = reminderId("2026-09-25", 0);
  const eight = reminderId("2026-09-25", 1);
  const delivered = new Set([two]); // the 2 pm one fired and is in the shade
  const before = planReadingReminders(state({ now, delivered }));
  assert.ok(before.schedule.some((r) => r.id === eight), "8 pm is scheduled before the edit");
  // At 3 pm the user moves the second time from 8 pm to 1 pm (already past).
  const slots = [
    { time: "14:00", enabled: true },
    { time: "13:00", enabled: true },
  ];
  const after = planReadingReminders(state({ now, slots, delivered, previous: applied(before) }));
  assert.ok(!after.schedule.some((r) => r.id === eight));
  assert.ok(after.cancel.includes(eight), "the old 8 pm alarm must be cancelled");
  assert.ok(!after.cancel.includes(two), "2 pm fired and is showing: left in the shade");
});

test(`[${TZ}] a past reminder is kept only if it is showing or was last planned at or before now`, () => {
  const now = at(2026, 9, 25, 15, 0);
  const two = reminderId("2026-09-25", 0);
  // No sign it ever fired (not showing, never planned): nothing to keep, so cancel.
  assert.ok(planReadingReminders(state({ now, delivered: new Set() })).cancel.includes(two));
  // active() unavailable, but the last plan had it at 2 pm: it fired, keep it.
  const morning = planReadingReminders(state({ now: at(2026, 9, 25, 10, 0) }));
  assert.ok(!planReadingReminders(state({ now, previous: applied(morning) })).cancel.includes(two));
  // ...and a third reconcile still knows, because kept ones are recorded too.
  const mid = planReadingReminders(state({ now, previous: applied(morning) }));
  assert.ok(!planReadingReminders(state({ now: now + 3_600_000, previous: applied(mid) })).cancel.includes(two));
});

test(`[${TZ}] the rolling window is today and tomorrow, so a reboot can replay at most two days`, () => {
  assert.equal(READING_WINDOW_DAYS, 2);
  const slots = ["06:00", "12:00", "18:00", "22:00"].map((time) => ({ time, enabled: true }));
  const { schedule, cancel } = planReadingReminders(state({ now: at(2026, 9, 25, 5, 0), slots }));
  assert.ok(schedule.every((r) => r.at < at(2026, 9, 27, 0, 0)), "nothing past tomorrow");
  // A build with the old 7-day window left ids up to a week out: they are swept too.
  for (let d = 27; d <= 30; d++) assert.ok(cancel.includes(reminderId(`2026-09-${d}`, 0)), `${d}`);
  assert.ok(cancel.includes(reminderId("2026-10-02", 3)));
});

test(`[${TZ}] upgrade: the reading reminder time chosen before v0.4 is kept`, () => {
  assert.equal(typeof rr.migrateReminderPrefs, "function", "migrateReminderPrefs exists");
  const m = rr.migrateReminderPrefs({ notifyPlan: true, reminderTime: "07:15", activePlanId: "p" }, 0);
  assert.deepEqual(m.readingReminderSlots, [
    { time: "07:15", enabled: true },
    { time: "20:00", enabled: true },
  ]);
  assert.equal(m.reminderTime, "07:15", "memory / prayers keep sharing it");
  // Their time already was 8 pm: one reminder, not two at the same minute.
  assert.deepEqual(rr.migrateReminderPrefs({ notifyPlan: true, reminderTime: "20:00" }, 0).readingReminderSlots, [
    { time: "20:00", enabled: true },
  ]);
  // Reading reminder was off: nothing chosen, so the defaults apply.
  assert.equal(rr.migrateReminderPrefs({ notifyPlan: false, reminderTime: "07:15" }, 0).readingReminderSlots, undefined);
  // A blob that already has slots (a v0.4 pre-release) is left alone.
  const slots = [{ time: "09:00", enabled: false }];
  assert.deepEqual(rr.migrateReminderPrefs({ notifyPlan: true, reminderTime: "07:15", readingReminderSlots: slots }, 0).readingReminderSlots, slots);
  // A bad old time falls back to the defaults rather than a broken slot.
  assert.equal(rr.migrateReminderPrefs({ notifyPlan: true, reminderTime: "nope" }, 0).readingReminderSlots, undefined);
  // Already migrated: untouched.
  assert.equal(rr.migrateReminderPrefs({ notifyPlan: true, reminderTime: "07:15" }, 1).readingReminderSlots, undefined);
});

const DAILY = [
  { kind: "devotion", enabled: true, time: "07:00", title: "Devotional", body: "b", largeBody: "lb" },
  { kind: "memory", enabled: true, time: "21:00", title: "Memory", body: "b", largeBody: "lb" },
  { kind: "prayers", enabled: false, time: "21:00", title: "Pray", body: "b", largeBody: "lb" },
];

test(`[${TZ}] devotional / memory / prayer reminders are rolling one-offs, not repeating alarms`, () => {
  assert.ok(daily, "src/lib/dailyReminders.ts exists");
  const now = at(2026, 9, 25, 10, 0);
  const { schedule, cancel } = daily.planDailyReminders({ now, reminders: DAILY });
  // 7 am today is past; 9 pm today is not. Two days, prayers off.
  assert.deepEqual(
    schedule.map((r) => `${r.kind} ${r.dayKey} ${hhmm(r.at)}`),
    ["memory 2026-09-25 21:00", "devotion 2026-09-26 07:00", "memory 2026-09-26 21:00"],
  );
  assert.ok(schedule.every((r) => r.at > now));
  assert.deepEqual(schedule.map((r) => r.deepLink), ["/memory", "/devotional", "/memory"]);
  // The old repeating alarms (8801-8804) are always cancelled, and so are prayers.
  for (const id of [8801, 8802, 8803, 8804]) assert.ok(cancel.includes(id), `${id}`);
  for (const d of ["2026-09-25", "2026-09-26", "2026-09-27"]) assert.ok(cancel.includes(daily.dailyReminderId("prayers", d)));
  // Nothing scheduled is also cancelled; re-planning gives the same ids.
  assert.ok(schedule.every((r) => !cancel.includes(r.id)));
  assert.deepEqual(daily.planDailyReminders({ now: now + 60_000, reminders: DAILY }).schedule.map((r) => r.id), schedule.map((r) => r.id));
  // What reaches the plugin is an exact, allow-while-idle one-off (setExactAndAllowWhileIdle),
  // never the `interval` schedule the plugin re-arms with a plain setExact.
  const p = JSON.parse(JSON.stringify(toPluginPayload(daily.toNative(schedule[0]), "c", "a")));
  checkStrictShape(p, "daily one-off");
  assert.deepEqual(Object.keys(p.schedule), ["at"]);
  assert.equal(p.schedule.at.repeating, false);
  assert.equal(p.schedule.at.allowWhileIdle, true);
});

test(`[${TZ}] daily reminders: today's fired one stays in the shade only if it is showing`, () => {
  assert.ok(daily, "src/lib/dailyReminders.ts exists");
  const now = at(2026, 9, 25, 10, 0);
  const id = daily.dailyReminderId("devotion", "2026-09-25");
  assert.ok(daily.planDailyReminders({ now, reminders: DAILY, delivered: new Set() }).cancel.includes(id));
  const kept = daily.planDailyReminders({ now, reminders: DAILY, delivered: new Set([id]) });
  assert.ok(!kept.cancel.includes(id));
  assert.deepEqual(kept.keep.map((k) => k.id), [id]);
  // Switched off: everything goes, the shade included.
  const off = daily.planDailyReminders({ now, reminders: DAILY.map((r) => ({ ...r, enabled: false })), delivered: new Set([id]) });
  assert.equal(off.schedule.length, 0);
  assert.ok(off.cancel.includes(id));
});

test(`[${TZ}] daily reminder ids: unique, inside a Java int, clear of reading ids, tap opens the screen`, () => {
  assert.ok(daily, "src/lib/dailyReminders.ts exists");
  const seen = new Set();
  for (let i = 0; i < 366; i++) {
    const key = localDayKey(at(2026, 1, 1, 12) + i * 86_400_000);
    for (const kind of ["devotion", "memory", "prayers"]) {
      const id = daily.dailyReminderId(kind, key);
      assert.ok(!seen.has(id));
      seen.add(id);
      assert.ok(id < 2 ** 31 && (id < READING_ID_BASE || id >= READING_ID_BASE + 10_000) && id > 8804);
    }
  }
  assert.equal(deepLinkFor({ id: daily.dailyReminderId("devotion", "2026-09-25") }), "/devotional");
  assert.equal(deepLinkFor({ id: daily.dailyReminderId("memory", "2026-09-25") }), "/memory");
  assert.equal(deepLinkFor({ id: daily.dailyReminderId("prayers", "2026-09-25") }), "/prayers");
});

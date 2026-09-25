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
  const s = state({ now: at(2026, 9, 25, 15, 0) });
  const { schedule, cancel } = planReadingReminders(s);
  const two = reminderId("2026-09-25", 0);
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
  const later = schedule.find((r) => r.dayKey === "2026-09-27");
  assert.equal(later.title, "Today’s reading");
  assert.equal(schedule.length, 2 * (READING_WINDOW_DAYS - 1));
});

test(`[${TZ}] done in the morning before any reminder: no reminders today at all`, () => {
  const s = state({ now: at(2026, 9, 25, 7, 30), doneToday: true, streak: { days: 5, includesToday: true } });
  const { schedule } = planReadingReminders(s);
  assert.equal(schedule[0].dayKey, "2026-09-26");
});

test(`[${TZ}] after 8 pm, not done: nothing new today, both of today's kept`, () => {
  const s = state({ now: at(2026, 9, 25, 21, 0) });
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
  const s = state({ now: at(2026, 10, 30, 9, 0) });
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

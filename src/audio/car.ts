/**
 * Android Auto, the app's half.
 *
 * The car browses the native side (src-tauri/plugins/native-audio, CarLibrary.kt), which
 * often runs without the app: the phone connects to the car, the service starts, the
 * WebView does not. So the app keeps two things in step:
 *
 * 1. A snapshot of what the car cannot work out for itself (today's plan day with its
 *    readings and audio, devotional audio, the narrator), pushed with `set_car_snapshot`
 *    whenever any of it changes. Native keeps it in SharedPreferences.
 * 2. Plan chapters and devotionals that played to their end. Native queues every one,
 *    whoever loaded the queue (the car, the app, or the app's own earlier session), because
 *    the app may not be there to hear it: swiped away, frozen in the background, or holding
 *    a queue it adopted from the car. The app collects them at start, when it comes back to
 *    the foreground, and whenever a state event says some are waiting
 *    (`take_car_completions`; the "car" in the command names is historical), records them
 *    exactly as the guided reader and the Listen button do (`setChapterDone`,
 *    `setDevotionDone`), then acknowledges them (`ack_car_completions`). Recording is
 *    idempotent, so a chapter the app also marked itself does no harm.
 *
 * The Bible tree (books, chapters, their URLs) is built natively from the same URL pattern
 * as src/audio/audioUrl.ts, so it needs nothing from here.
 */
import { useEffect } from "react";
import { liveQuery } from "dexie";
import { db } from "@/db";
import { setChapterDone, setDevotionDone } from "@/db/repos";
import { getAnyPlan } from "@/data/plans";
import { devotionalById, getDevotionDay } from "@/data/devotional";
import { translationById } from "@/data/bible";
import { refLabel } from "@/lib/osis";
import { useUI } from "@/store/ui";
import { setNativeCompletionsHandler } from "./controller";
import { devotionDoneId, parseCarDevotionalId } from "./devotionalIds";
import { chapterAudioUrl, DEFAULT_AUDIO_TRANSLATION, DEFAULT_NARRATOR } from "./audioUrl";
import { groupDayReadings, groupIndexByReading } from "./readingGroups";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
/** Only the Android app has a car to talk to. */
export const carSupported = isTauri && isAndroid;

export interface CarTrack {
  readingIndex: number;
  group: number;
  ho: string;
  chapter: number;
  title: string;
  subtitle: string;
  src: string;
  done: boolean;
}

export interface CarDevotional {
  /** Stable for the day, e.g. "spurgeon-morning-evening:09-25:m". */
  id: string;
  /** "Morning" / "Evening". */
  label: string;
  title: string;
  subtitle: string;
  src: string;
}

export interface CarSnapshot {
  version: 1;
  updatedAt: number;
  translation: string;
  narrator: string;
  today: {
    planId: string;
    planName: string;
    day: number;
    readings: { index: number; label: string; kicker: string; tracks: number[] }[];
    tracks: CarTrack[];
  } | null;
  devotional: CarDevotional[];
}

/**
 * Where today's spoken devotional audio comes from. Nothing by default: the recordings are
 * still being made (feat/devotional-audio). Whatever registers here is asked for today's
 * entries; the car shows its Devotional tab only when this returns some.
 */
type DevotionalSource = () => Promise<CarDevotional[]>;
let devotionalSource: DevotionalSource | null = null;
export function registerCarDevotionalSource(fn: DevotionalSource | null) {
  devotionalSource = fn;
  if (carSupported) schedulePush();
}

function subtitleFor(translation: string, narrator: string): string {
  const name = translationById(translation)?.name ?? translation;
  return `${name} · ${narrator.charAt(0).toUpperCase()}${narrator.slice(1)}`;
}

/** Today's plan day: the first day of the active plan not yet completed. */
export async function buildCarSnapshot(activePlanId: string | null): Promise<CarSnapshot> {
  const translation = DEFAULT_AUDIO_TRANSLATION; // the only translation with narration
  const narrator = DEFAULT_NARRATOR;
  const subtitle = subtitleFor(translation, narrator);
  let today: CarSnapshot["today"] = null;
  if (activePlanId) {
    const plan = await getAnyPlan(activePlanId);
    const prog = await db.plans.get(activePlanId);
    if (plan) {
      const doneDays = new Set(prog?.completedDays ?? []);
      let day = 0;
      while (day < plan.days.length && doneDays.has(day)) day++;
      const readings = plan.days[day];
      if (readings?.length) {
        const doneReadings = new Set(prog?.chapterProgress?.[day] ?? []);
        const groups = groupDayReadings(readings);
        const groupOf = groupIndexByReading(groups);
        today = {
          planId: plan.id,
          planName: plan.name,
          day,
          readings: groups.map((g) => ({ index: g.index, label: g.label, kicker: g.kicker, tracks: g.items })),
          tracks: readings.map((r, i) => ({
            readingIndex: i,
            group: groupOf[i] ?? 0,
            ho: r.ho,
            chapter: r.chapter,
            title: refLabel(r.ho, r.chapter),
            subtitle,
            src: chapterAudioUrl(r.ho, r.chapter, narrator, translation),
            done: doneReadings.has(i),
          })),
        };
      }
    }
  }
  let devotional: CarDevotional[] = [];
  try {
    devotional = (await devotionalSource?.()) ?? [];
  } catch {
    devotional = [];
  }
  return { version: 1, updatedAt: Date.now(), translation, narrator, today, devotional };
}

type Invoke = typeof import("@tauri-apps/api/core").invoke;
let invokeFn: Promise<Invoke> | null = null;
function invoke(): Promise<Invoke> {
  invokeFn ??= import("@tauri-apps/api/core").then((m) => m.invoke);
  return invokeFn;
}

let lastPushed = "";
let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** Send the snapshot to native, if it changed (ignoring the timestamp). */
export async function pushCarSnapshot(): Promise<void> {
  if (!carSupported) return;
  const snap = await buildCarSnapshot(useUI.getState().activePlanId);
  const key = JSON.stringify({ ...snap, updatedAt: 0 });
  if (key === lastPushed) return;
  try {
    await (await invoke())("plugin:native-audio|set_car_snapshot", { json: JSON.stringify(snap) });
    lastPushed = key;
  } catch (e) {
    console.warn("car: snapshot not sent", e);
  }
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void pushCarSnapshot(), 800);
}

interface NativeCompletion {
  seq: number;
  /** Absent on entries written before devotionals were recorded: those are plan chapters. */
  kind?: "plan" | "devotional";
  planId?: string;
  planDay?: number;
  planReadingIndex?: number;
  /** The car's devotional id, "spurgeon-morning-evening:09-25:m". */
  devotionalId?: string;
  completedAt: number;
}

/** Record one completion. Idempotent: the same entry recorded twice changes nothing. */
async function recordCompletion(c: NativeCompletion): Promise<void> {
  if (c.kind === "devotional") {
    const car = c.devotionalId ? parseCarDevotionalId(c.devotionalId) : null;
    if (!car) return;
    // Its index in the day, found by label (Morning is 0 only when the day has one).
    const day = await getDevotionDay(devotionalById(car.devotionalId), car.day).catch(() => undefined);
    const label = car.slot === "morning" ? "Morning" : "Evening";
    const found = day?.readings.findIndex((r) => r.label === label) ?? -1;
    const id = devotionDoneId(car.devotionalId, car.day, found >= 0 ? found : car.slot === "morning" ? 0 : 1);
    // Keep the first completion time if the app already marked it.
    if (!(await db.devotions.get(id))) await setDevotionDone(id, true);
    return;
  }
  if (c.planId == null || c.planDay == null || c.planReadingIndex == null) return;
  const plan = await getAnyPlan(c.planId);
  const total = plan?.days[c.planDay]?.length ?? 0;
  if (plan && total > 0 && c.planReadingIndex < total) {
    await setChapterDone(c.planId, c.planDay, c.planReadingIndex, true, total);
  }
  // A plan that no longer exists has nothing to record; it is dropped all the same.
}

let draining: Promise<void> | null = null;
/** Asked again while a drain was running: run once more after it, for what arrived since. */
let drainAgain = false;

/** Record what native heard to the end, then tell native those entries are safe to forget. */
export function drainNativeCompletions(): Promise<void> {
  if (!carSupported) return Promise.resolve();
  if (draining) {
    drainAgain = true;
    return draining;
  }
  draining = (async () => {
    try {
      const call = await invoke();
      const { items } = await call<{ items: NativeCompletion[] }>("plugin:native-audio|take_car_completions");
      if (!items?.length) return;
      let upTo = 0;
      for (const c of items) {
        await recordCompletion(c);
        upTo = Math.max(upTo, c.seq);
      }
      await call("plugin:native-audio|ack_car_completions", { upTo });
    } catch (e) {
      console.warn("audio: completions not collected", e);
    }
  })().finally(() => {
    draining = null;
    if (drainAgain) {
      drainAgain = false;
      void drainNativeCompletions();
    }
  });
  return draining;
}

/**
 * Mount once (AppShell). Pushes the snapshot at start, when the active plan or its
 * progress changes, when the day may have rolled over (the app comes back), and collects
 * the car's completions at start and whenever native reports some waiting.
 */
export function useCarSync(): void {
  const activePlanId = useUI((s) => s.activePlanId);

  useEffect(() => {
    if (carSupported) schedulePush();
  }, [activePlanId]);

  useEffect(() => {
    if (!carSupported) return;
    setNativeCompletionsHandler(() => void drainNativeCompletions());
    void drainNativeCompletions();
    const sub = liveQuery(() => db.plans.toArray()).subscribe({
      next: () => schedulePush(),
      error: (e) => console.error("car: plan watch failed", e),
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void drainNativeCompletions();
        schedulePush();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      setNativeCompletionsHandler(null);
      sub.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

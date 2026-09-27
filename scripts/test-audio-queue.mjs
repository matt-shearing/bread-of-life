/**
 * Regression tests for the audio controller (src/audio/controller.ts) on Android, driving
 * NativeEngine (src/audio/engine.ts) through the typed plugin wrapper (nativeAudio.ts);
 * the native completions drain (nativeCompletions.ts); and the Linux desktop engine.
 *
 * Run: pnpm test:audio   (or: node scripts/test-audio-queue.mjs)
 *
 * Needs Node 23.6+ (imports the TypeScript sources directly). `@tauri-apps/api/core` and
 * React are replaced with small in-memory stubs via a module-resolution hook, so the REAL
 * controller and engines run unchanged.
 *
 * The first bug this guarded: after jumping in a plan day's queue, progress ticks the
 * native player captured BEFORE the jump landed (still carrying the old index) reached JS
 * and were taken as "the player advanced", so jumping BACK marked the chapters between
 * as read (and could complete the plan day), and jumping forward flicked the mini-player
 * back to the old chapter. Jumps are now `skip_to` within the loaded queue.
 */
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

const STUBS = {
  react: "data:text/javascript," + encodeURIComponent(`
    export function useRef(current) { return { current }; }
    export function useSyncExternalStore(subscribe, get) {
      globalThis.__capture?.(subscribe, get);
      globalThis.__audioSubscribe?.(subscribe, get);
      return get();
    }`),
  "@tauri-apps/api/core": "data:text/javascript," + encodeURIComponent(`
    export async function invoke(cmd, args) {
      globalThis.__calls.push(cmd);
      return globalThis.__native.invoke(cmd, args);
    }
    export async function addPluginListener(plugin, event, cb) {
      globalThis.__calls.push("addPluginListener:" + plugin + ":" + event);
      globalThis.__nativeEmit = cb;
      return { unregister() {} };
    }`),
};
globalThis.__calls = [];
const src = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: STUBS[specifier], shortCircuit: true };
    // The sources import their siblings without an extension, and "@/…" for src/, as Vite allows.
    if (specifier.startsWith("@/")) return next(new URL(`${specifier.slice(2)}.ts`, src).href, context);
    if (/^\.\/\w+$/.test(specifier) && /\/src\/(audio|lib)\//.test(context.parentURL ?? "")) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
});

// An Android WebView inside Tauri, so selectEngine() picks NativeEngine.
globalThis.window = { __TAURI_INTERNALS__: {} };
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0 (Linux; Android 16)" },
  configurable: true,
});

/**
 * The native side: a monotonic clock, the playlist index, the queue generation, the
 * indexes that finished NATURALLY in this generation (Media3's AUTO transitions and the
 * end of the playlist; see NativeAudioRuntime.finishedIndexes), and a gate on set_queue.
 */
const native = {
  clock: 1000,
  index: 0,
  gen: 0,
  finished: [],
  playing: true,
  time: 1,
  gate: Promise.resolve(),
  /** The sleep timer native runs (NativeAudioRuntime.sleepTimer), and every set_sleep_timer. */
  sleep: null,
  sleepCalls: [],
  snapshot(index = native.index) {
    return {
      sleepTimer: native.sleep,
      status: native.playing ? "playing" : "idle", currentTime: native.time, duration: 60, isPlaying: native.playing,
      buffering: false, rate: 1, index, capturedAtMs: ++native.clock, queueGeneration: native.gen, queueOrigin: "app",
      finished: [...native.finished],
    };
  },
  /** The current chapter ran to its end and ExoPlayer moved on by itself. */
  advance() {
    native.finished.push(native.index);
    native.index++;
    return native.snapshot();
  },
  /** A skip: the car's Next / "Next reading", the lock screen's button, the app's next. */
  skipTo(i) {
    native.index = i;
    return native.snapshot();
  },
  /** The last chapter ran to its end: the playlist is over. */
  end() {
    native.finished.push(native.index);
    return { ...native.snapshot(), status: "ended", isPlaying: false };
  },
  async invoke(cmd, args) {
    await native.gate; // the round trip to native takes time
    if (cmd === "plugin:native-audio|set_sleep_timer") {
      native.sleepCalls.push(args);
      native.sleep = args.atEpochMs
        ? { mode: "time", endsAtEpochMs: args.atEpochMs, remainingMs: args.atEpochMs - Date.now() }
        : args.endOfItem
          ? { mode: "item", remainingMs: 59_000 }
          : args.endOfGroup
            ? { mode: "group" }
            : null;
      return native.snapshot();
    }
    if (cmd === "plugin:native-audio|set_queue") {
      native.sleep = null; // a new queue clears the timer
      native.index = args.startIndex;
      native.gen++;
      native.finished = [];
      native.playing = true;
      globalThis.__nativeEmit(native.snapshot()); // setQueue() ends with emitState()
      return native.snapshot(); // ...and the command resolves with getState()
    }
    if (cmd === "plugin:native-audio|skip_to") {
      // NativeAudioRuntime.skipTo: a seek within the playlist, refused for another queue.
      if (args.queueGeneration != null && args.queueGeneration !== native.gen) throw "stale queue";
      native.index = args.index;
      native.playing = true;
      globalThis.__nativeEmit(native.snapshot());
      return native.snapshot();
    }
    if (cmd === "plugin:native-audio|stop") {
      native.sleep = null;
      native.gen++;
      native.index = 0;
      native.finished = [];
      native.playing = false;
      globalThis.__nativeEmit(native.snapshot());
      return native.snapshot();
    }
    return native.snapshot();
  },
};
globalThis.__native = native;

const indexHistory = [];
globalThis.__audioSubscribe = (subscribe, get) => {
  if (globalThis.__subscribed) return;
  globalThis.__subscribed = true;
  subscribe(() => indexHistory.push(get().index));
};

const c = await import("../src/audio/controller.ts");
const tick = () => new Promise((r) => setTimeout(r, 5));
await tick();
c.useAudio();

test("nothing native is built until the first play (no notification prompt at start)", async () => {
  // At import the engine only listens and asks whether something already plays.
  assert.ok(globalThis.__calls.includes("addPluginListener:native-audio:native_audio_state"));
  assert.ok(globalThis.__calls.includes("plugin:native-audio|get_state"));
  assert.ok(!globalThis.__calls.includes("plugin:native-audio|initialize"), JSON.stringify(globalThis.__calls));
  c.playQueue([{ ho: "GEN", chapter: 1, src: "https://x/0.mp3", title: "Genesis 1", subtitle: "BSB" }]);
  await tick();
  const i = globalThis.__calls.indexOf("plugin:native-audio|initialize");
  assert.ok(i >= 0 && i < globalThis.__calls.indexOf("plugin:native-audio|set_queue"), "initialize before the first queue");
  c.stop();
  await tick();
});

const tracks = [0, 1, 2, 3, 4, 5].map((i) => ({
  ho: "GEN",
  chapter: i + 1,
  src: `https://x/${i}.mp3`,
  title: `Genesis ${i + 1}`,
  subtitle: "BSB",
  planReadingIndex: i,
}));

/** Run `jumpTo(to)` with skip_to held open while stale ticks arrive. */
async function jumpWithStaleTicks(to, staleIndexes) {
  let release;
  native.gate = new Promise((r) => (release = r));
  // Ticks the native player captured BEFORE set_queue ran: they carry the old index.
  const stale = staleIndexes.map((i) => native.snapshot(i));
  globalThis.__calls.length = 0;
  c.jumpTo(to);
  for (const s of stale) globalThis.__nativeEmit(s);
  release();
  await tick();
  native.gate = Promise.resolve();
  // A late duplicate of a stale tick (queued while the WebView was busy) must not win either.
  for (const s of stale) globalThis.__nativeEmit(s);
  await tick();
  // A jump moves within native's playlist; the whole queue is not sent again.
  assert.ok(globalThis.__calls.includes("plugin:native-audio|skip_to"), JSON.stringify(globalThis.__calls));
  assert.ok(!globalThis.__calls.includes("plugin:native-audio|set_queue"), "no set_queue for a jump");
}

test("jumping back in the queue marks nothing read and lands on the chosen chapter", async () => {
  const marked = [];
  c.playQueue(tracks, { startIndex: 0, onComplete: (_t, k) => marked.push(k) });
  await tick();
  globalThis.__nativeEmit(native.snapshot(0));

  // "Next reading" skips Genesis 1-3 to index 3. Skipping is not listening.
  await jumpWithStaleTicks(3, [0]);
  assert.deepEqual(marked, [], "skipping forward marks nothing");
  assert.ok(c.isCurrentChapter("GEN", 4));

  // Back to index 1 from the day list, with a tick still saying index 3 in flight.
  await jumpWithStaleTicks(1, [3]);
  assert.deepEqual(marked, [], "listened to nothing past index 0, so nothing is marked");
  assert.ok(c.isCurrentChapter("GEN", 2), "the player shows the chapter jumped to");

  // Real advancement after the jump still marks the chapter that finished.
  globalThis.__nativeEmit(native.advance());
  assert.deepEqual(marked, [1]);
  c.stop();
});

test("jumping forward never flicks the mini-player back to the old chapter", async () => {
  c.playQueue(tracks, { startIndex: 0 });
  await tick();
  globalThis.__nativeEmit(native.snapshot(0));
  indexHistory.length = 0;
  await jumpWithStaleTicks(4, [0, 0]);
  assert.ok(indexHistory.length > 0);
  assert.ok(indexHistory.every((i) => i === 4), `index went ${JSON.stringify(indexHistory)}`);
  c.stop();
});

test("rapid jumps: the player ends on the last chapter chosen", async () => {
  const marked = [];
  c.playQueue(tracks, { startIndex: 0, onComplete: (_t, k) => marked.push(k) });
  await tick();
  let releaseA;
  native.gate = new Promise((r) => (releaseA = r));
  c.jumpTo(5);
  c.jumpTo(2);
  releaseA();
  await tick();
  native.gate = Promise.resolve();
  assert.ok(c.isCurrentChapter("GEN", 3), "ends on the last chapter chosen");
  assert.deepEqual(marked, []);
  c.stop();
});

test("a spoken devotional (one file track) is marked complete when the native player ends", async () => {
  const done = [];
  const devo = {
    ho: "",
    chapter: 0,
    src: "file:///data/user/0/app/cache/device-tts/morning-09-25-abc.wav",
    title: "Morning — 25 September · Spurgeon",
    subtitle: "Romans 3:26 · Phone's voice",
    devotional: { devotionalId: "spurgeon-morning-evening", day: "09-25", slot: "morning", index: 0, ref: "Romans 3:26", voice: "device" },
  };
  let setQueueArgs = null;
  const invoke = native.invoke;
  native.invoke = async (cmd, args) => {
    if (cmd === "plugin:native-audio|set_queue") setQueueArgs = args;
    return invoke(cmd, args);
  };
  c.playQueue([devo], { onComplete: (t) => done.push(t.devotional.index) });
  await tick();
  native.invoke = invoke;
  assert.equal(setQueueArgs.items[0].src, devo.src, "the file:// URI goes to the native queue untouched");
  assert.equal(setQueueArgs.items[0].title, devo.title);
  globalThis.__nativeEmit(native.snapshot(0));
  assert.deepEqual(done, [], "not complete while playing");
  globalThis.__nativeEmit(native.end());
  assert.deepEqual(done, [0], "finishing the reading marks it complete");
  c.stop();
});

/* ------------------------- skips versus natural advances ------------------------- */

test("the car's Next reading (or the lock screen's) on the app's plan queue marks nothing read", async () => {
  const marked = [];
  c.playQueue(tracks, { startIndex: 0, onComplete: (_t, k) => marked.push(k) });
  await tick();
  globalThis.__nativeEmit(native.snapshot(0));
  // 10 s into Genesis 1, NativeAudioRuntime.nextReading() -> exo.seekTo(3, 0): a SEEK transition.
  globalThis.__nativeEmit(native.skipTo(3));
  assert.deepEqual(marked, [], "Genesis 1-3 were skipped, not heard");
  assert.ok(c.isCurrentChapter("GEN", 4), "the mini-player follows the skip");
  // The car's plain Next (seekToNextMediaItem) is a skip too.
  globalThis.__nativeEmit(native.skipTo(4));
  assert.deepEqual(marked, []);
  // Genesis 5 then plays to its end: that one is heard.
  globalThis.__nativeEmit(native.advance());
  assert.deepEqual(marked, [4]);
  c.stop();
});

test("a background run of advances and skips, delivered as one late event, marks exactly the chapters heard", async () => {
  const marked = [];
  c.playQueue(tracks, { startIndex: 0, onComplete: (_t, k) => marked.push(k) });
  await tick();
  globalThis.__nativeEmit(native.snapshot(0));
  // The WebView is frozen: Genesis 1 and 2 finish, the car skips Genesis 3-4, Genesis 5 finishes.
  native.advance();
  native.advance();
  native.skipTo(4);
  const last = native.advance();
  // Only the newest state reaches JS when the app comes back.
  globalThis.__nativeEmit(last);
  assert.deepEqual(marked, [0, 1, 4]);
  assert.ok(c.isCurrentChapter("GEN", 6));
  // Later events repeat the same list; nothing is marked twice.
  globalThis.__nativeEmit(native.snapshot());
  assert.deepEqual(marked, [0, 1, 4]);
  // The last chapter ends: it is marked once, and the skipped ones still are not.
  globalThis.__nativeEmit(native.end());
  globalThis.__nativeEmit({ ...native.snapshot(), status: "ended", isPlaying: false });
  assert.deepEqual(marked, [0, 1, 4, 5]);
  c.stop();
});

test("after a jump, a chapter heard before it is not marked again and the new queue's advances still mark", async () => {
  const marked = [];
  c.playQueue(tracks, { startIndex: 0, onComplete: (_t, k) => marked.push(k) });
  await tick();
  globalThis.__nativeEmit(native.advance()); // Genesis 1 heard
  assert.deepEqual(marked, [0]);
  // Jump to Genesis 4 with ticks from the old queue (carrying its list) still in flight.
  await jumpWithStaleTicks(3, [1]);
  assert.deepEqual(marked, [0]);
  globalThis.__nativeEmit(native.advance()); // Genesis 4 heard
  assert.deepEqual(marked, [0, 3]);
  c.stop();
});

/* --------------------------------- Android Auto --------------------------------- */

test("the app's queue tells native each chapter's media id and reading group", async () => {
  const sent = [];
  const orig = native.invoke;
  native.invoke = async (cmd, args) => {
    if (cmd === "plugin:native-audio|set_queue") sent.push(args);
    return orig(cmd, args);
  };
  const day = [
    { ho: "GEN", chapter: 1, src: "https://audio.bible.helloao.org/api/BSB/GEN/1/audio/david.mp3", title: "Genesis 1", subtitle: "BSB", planId: "soul-food", planDay: 4, planReadingIndex: 0, readingGroup: 0 },
    { ho: "MAT", chapter: 1, src: "https://audio.bible.helloao.org/api/BSB/MAT/1/audio/david.mp3", title: "Matthew 1", subtitle: "BSB", planId: "soul-food", planDay: 4, planReadingIndex: 1, readingGroup: 1 },
    { ho: "JHN", chapter: 3, src: "https://audio.bible.helloao.org/api/BSB/JHN/3/audio/david.mp3", title: "John 3", subtitle: "BSB" },
    { ho: "JHN", chapter: 3, src: "/missler/john.mp3#t=120", title: "Missler", subtitle: "Missler Inspired" },
  ];
  c.playQueue(day, { startIndex: 0 });
  await tick();
  native.invoke = orig;
  const items = sent[0].items;
  assert.equal(items[0].mediaId, "plan/soul-food/4/0/GEN/1");
  assert.equal(items[0].group, 0);
  assert.equal(items[1].mediaId, "plan/soul-food/4/1/MAT/1");
  assert.equal(items[1].group, 1);
  assert.equal(items[2].mediaId, "ch/JHN/3");
  assert.equal(items[3].mediaId, undefined, "Missler audio is not a Bible chapter");
  c.stop();
});

test("a queue started from the car is adopted, and marks nothing in the app's queue", async () => {
  const marked = [];
  c.playQueue(tracks, { startIndex: 0, onComplete: (_t, k) => marked.push(k) });
  await tick();
  globalThis.__nativeEmit(native.snapshot(0));

  // The car plays John 3 onwards: native swaps the queue and reports it as "car".
  const carQueue = [3, 4, 5].map((ch) => ({
    mediaId: `ch/JHN/${ch}`,
    src: `https://audio.bible.helloao.org/api/BSB/JHN/${ch}/audio/david.mp3`,
    title: `John ${ch}`,
    subtitle: "Berean Standard Bible · David",
    ho: "JHN",
    chapter: ch,
  }));
  const orig = native.invoke;
  native.invoke = async (cmd, args) => {
    if (cmd === "plugin:native-audio|get_queue") return { items: carQueue, index: 1, queueGeneration: 99, queueOrigin: "car" };
    return orig(cmd, args);
  };
  // Its index (1) must not be read as "the day's queue advanced past Genesis 1".
  // (Native's generation only ever rises; the car's queue is the next one.)
  native.gen = 99;
  globalThis.__nativeEmit({ ...native.snapshot(1), queueGeneration: 99, queueOrigin: "car" });
  await tick();
  assert.deepEqual(marked, [], "nothing in the old queue was listened to");
  assert.ok(c.isCurrentChapter("JHN", 4), "the mini-player shows the car's chapter");

  // The car's queue advancing later marks nothing either: native records plan chapters itself.
  globalThis.__nativeEmit({ ...native.snapshot(2), queueGeneration: 99, queueOrigin: "car" });
  assert.deepEqual(marked, []);
  assert.ok(c.isCurrentChapter("JHN", 5));
  native.invoke = orig;
  c.stop();
});

test("native saying car completions are waiting reaches the handler", async () => {
  let seen = 0;
  c.setNativeCompletionsHandler((n) => (seen = n));
  globalThis.__nativeEmit({ ...native.snapshot(0), pendingCompletions: 2 });
  assert.equal(seen, 2);
  c.setNativeCompletionsHandler(null);
});

/* ------------------------------- review fixes (B1 B3 B9) ------------------------------- */

/** Mount a hook the way React does: re-render only when its snapshot changes. */
function mount(hook) {
  let sub, get;
  globalThis.__capture = (s, g) => {
    sub = s;
    get = g;
  };
  hook();
  globalThis.__capture = null;
  const m = { value: get(), renders: 0, unsubscribe: null };
  m.unsubscribe = sub(() => {
    const v = get();
    if (!Object.is(v, m.value)) {
      m.value = v;
      m.renders++;
    }
  });
  return m;
}

test("an unchanged native tick notifies nobody, and a selector on `playing` ignores the time", async () => {
  native.time = 1;
  c.playQueue(tracks, { startIndex: 0 });
  await tick();
  globalThis.__nativeEmit(native.snapshot(0));
  const whole = mount(() => c.useAudio());
  const playing = mount(() => c.useAudioSelector((s) => s.playing));
  const clock = mount(() => c.useAudioSelector((s) => ({ t: s.currentTime, d: s.duration })));

  globalThis.__nativeEmit(native.snapshot(0)); // same values; only capturedAtMs moves
  c.setRate(c.useAudio().rate); // a patch that changes nothing
  assert.equal(whole.renders, 0, "nothing changed, so nothing re-renders");

  native.time = 2;
  globalThis.__nativeEmit(native.snapshot(0));
  native.time = 3;
  globalThis.__nativeEmit(native.snapshot(0));
  assert.equal(whole.renders, 2, "the whole state follows the time");
  assert.equal(clock.renders, 2, "so does a component that shows it");
  assert.equal(playing.renders, 0, "a component that shows only play/pause does not");

  native.playing = false;
  globalThis.__nativeEmit(native.snapshot(0));
  assert.equal(playing.renders, 1);
  assert.equal(playing.value, false);
  for (const m of [whole, playing, clock]) m.unsubscribe();
  native.playing = true;
  native.time = 1;
  c.stop();
  await tick();
});

test("closing the player unloads native's queue, and an earphone press cannot bring it back unseen", async () => {
  c.playQueue(tracks, { startIndex: 2 });
  await tick();
  globalThis.__nativeEmit(native.snapshot());
  globalThis.__calls.length = 0;
  c.stop();
  await tick();
  assert.ok(globalThis.__calls.includes("plugin:native-audio|stop"), JSON.stringify(globalThis.__calls));
  assert.ok(!globalThis.__calls.includes("plugin:native-audio|pause"), "not just a pause");
  let s = c.useAudio();
  assert.equal(s.queue.length, 0);
  assert.equal(s.index, -1);

  // A late event from the old queue, and native's own "stopped" state: nothing reappears.
  globalThis.__nativeEmit({ ...native.snapshot(2), queueGeneration: native.gen - 1, isPlaying: true, status: "playing" });
  globalThis.__nativeEmit(native.snapshot());
  s = c.useAudio();
  assert.equal(s.queue.length, 0);
  assert.equal(s.index, -1);
  assert.equal(s.playing, false);

  // An earphone press now resumes Continue listening through the session: native reports
  // it as an external queue, which the app adopts, so the mini-player shows it.
  const resumed = [{ mediaId: "ch/ROM/8", src: "https://audio.bible.helloao.org/api/BSB/ROM/8/audio/david.mp3", title: "Romans 8", subtitle: "BSB", ho: "ROM", chapter: 8 }];
  const orig = native.invoke;
  native.invoke = async (cmd, args) => {
    if (cmd === "plugin:native-audio|get_queue") return { items: resumed, index: 0, queueGeneration: native.gen };
    return orig(cmd, args);
  };
  native.gen++;
  native.playing = true;
  globalThis.__nativeEmit({ ...native.snapshot(0), queueOrigin: "external" });
  await tick();
  native.invoke = orig;
  assert.ok(c.isCurrentChapter("ROM", 8));
  assert.equal(c.useAudio().playing, true);
  c.stop();
  await tick();
});

test("a devotional started in the app carries its dev/ media id, so native records it", async () => {
  const sent = [];
  const orig = native.invoke;
  native.invoke = async (cmd, args) => {
    if (cmd === "plugin:native-audio|set_queue") sent.push(args);
    return orig(cmd, args);
  };
  c.playQueue([{
    ho: "",
    chapter: 0,
    src: "https://github.com/x/releases/download/devotional-audio-v1/morning/09-25.mp3",
    title: "Morning — 25 September · Spurgeon",
    subtitle: "Romans 3:26 · C. H. Spurgeon",
    devotional: { devotionalId: "spurgeon-morning-evening", day: "09-25", slot: "morning", index: 0, ref: "Romans 3:26", voice: "recording" },
  }]);
  await tick();
  native.invoke = orig;
  // The same id the car uses (carDevotionalId), encoded as native's MediaIds.devotional does.
  assert.equal(sent[0].items[0].mediaId, "dev/spurgeon-morning-evening%3A09-25%3Am");
  const { parseCarDevotionalId } = await import("../src/audio/devotionalIds.ts");
  assert.deepEqual(parseCarDevotionalId(decodeURIComponent(sent[0].items[0].mediaId.slice(4))), {
    devotionalId: "spurgeon-morning-evening", day: "09-25", slot: "morning",
  });
  c.stop();
  await tick();
});

test("a jump into a queue native no longer holds falls back to handing over the whole queue", async () => {
  c.playQueue(tracks, { startIndex: 0 });
  await tick();
  globalThis.__nativeEmit(native.snapshot(0));
  // The car replaced the queue a moment ago; the app has not heard yet.
  native.gen++;
  globalThis.__calls.length = 0;
  c.jumpTo(4);
  await tick();
  await tick();
  assert.ok(globalThis.__calls.includes("plugin:native-audio|skip_to"));
  assert.ok(globalThis.__calls.includes("plugin:native-audio|set_queue"), JSON.stringify(globalThis.__calls));
  assert.ok(c.isCurrentChapter("GEN", 5));
  c.stop();
  await tick();
});

/* ------------------------------------- sleep timer -------------------------------------- */

test("sleep timer: minutes reach native as a wall-clock time, and the state shows the time left", async () => {
  c.playQueue(tracks, { startIndex: 0 });
  await tick();
  native.sleepCalls.length = 0;
  const before = Date.now();
  c.setSleepTimer({ minutes: 15 });
  let s = c.useAudio();
  assert.equal(s.sleep?.kind, "time", "shown at once, before native answers");
  await tick();
  assert.equal(native.sleepCalls.length, 1);
  const at = native.sleepCalls[0].atEpochMs;
  assert.ok(Number.isInteger(at), "whole milliseconds");
  assert.ok(at >= before + 15 * 60_000 && at <= Date.now() + 15 * 60_000, `atEpochMs ${at}`);
  assert.deepEqual(Object.keys(native.sleepCalls[0]), ["atEpochMs"]);
  s = c.useAudio();
  assert.deepEqual(s.sleep, { kind: "time", endsAt: at }, "native's own end time");
  const left = c.sleepRemainingMs(s);
  assert.ok(left > 14.9 * 60_000 && left <= 15 * 60_000, `remaining ${left}`);
  assert.equal(c.sleepRemainingMs(s, at - 5_000), 5_000);
  assert.equal(c.sleepRemainingMs(s, at + 1), 0);

  // Native's ticks repeat the timer; only a change reaches subscribers.
  globalThis.__nativeEmit(native.snapshot());
  globalThis.__nativeEmit(native.snapshot());
  assert.equal(c.useAudio(), s, "an unchanged timer (and time) leaves the state as it was");
  c.stop();
  await tick();
});

test("sleep timer: end of chapter and end of reading map to native's item and group", async () => {
  // A plan day: Genesis 1–2 is one reading, Genesis 3 the next.
  const day = tracks.slice(0, 3).map((t, i) => ({ ...t, planId: "p", planDay: 0, readingGroup: i < 2 ? 0 : 1 }));
  c.playQueue(day, { startIndex: 0 });
  await tick();
  native.sleepCalls.length = 0;
  assert.equal(c.hasReadings(c.useAudio()), true);
  assert.equal(c.isLastOfReading(day, 0), false);
  assert.equal(c.isLastOfReading(day, 1), true);

  c.setSleepTimer({ endOf: "chapter" });
  await tick();
  assert.deepEqual(native.sleepCalls.at(-1), { endOfItem: true });
  assert.deepEqual(c.useAudio().sleep, { kind: "chapter" });
  // Time left in the chapter, at the playing speed.
  globalThis.__nativeEmit({ ...native.snapshot(), currentTime: 30, duration: 60 });
  assert.equal(c.sleepRemainingMs(c.useAudio()), 30_000);

  c.setSleepTimer({ endOf: "reading" });
  await tick();
  assert.deepEqual(native.sleepCalls.at(-1), { endOfGroup: true });
  assert.deepEqual(c.useAudio().sleep, { kind: "reading" });
  assert.equal(c.sleepRemainingMs(c.useAudio()), null, "Genesis 2 is still to come");

  // Outside a plan day there are no readings: "end of reading" is the chapter.
  c.playQueue(tracks.slice(0, 2), { startIndex: 0 });
  await tick();
  assert.equal(c.useAudio().sleep, null, "a new queue starts without a timer");
  c.setSleepTimer({ endOf: "reading" });
  await tick();
  assert.deepEqual(native.sleepCalls.at(-1), { endOfItem: true });
  c.stop();
  await tick();
});

test("sleep timer: cancel, native firing it, and events from before the set", async () => {
  c.playQueue(tracks, { startIndex: 1 });
  await tick();
  c.setSleepTimer({ minutes: 5 });
  await tick();
  c.setSleepTimer(null);
  assert.equal(c.useAudio().sleep, null, "gone at once");
  await tick();
  assert.deepEqual(native.sleepCalls.at(-1), {}, "set_sleep_timer with nothing cancels");
  assert.equal(c.useAudio().sleep, null);

  // A tick captured before set_sleep_timer landed must not wipe the timer the app shows.
  let release;
  native.gate = new Promise((r) => (release = r));
  c.setSleepTimer({ minutes: 30 });
  globalThis.__nativeEmit({ ...native.snapshot(), sleepTimer: null });
  assert.equal(c.useAudio().sleep?.kind, "time");
  release();
  native.gate = Promise.resolve();
  await tick();
  assert.equal(c.useAudio().sleep?.kind, "time");

  // Native fires it in the background: paused, not stopped, and no timer.
  native.sleep = null;
  native.playing = false;
  globalThis.__nativeEmit(native.snapshot());
  const s = c.useAudio();
  assert.equal(s.sleep, null);
  assert.equal(s.playing, false);
  assert.equal(s.queue.length, tracks.length, "the queue is still there to resume");

  // Set from the car's button: the app shows it too.
  native.sleep = { mode: "item", remainingMs: 1000 };
  globalThis.__nativeEmit(native.snapshot());
  assert.deepEqual(c.useAudio().sleep, { kind: "chapter" });
  // Stop clears it (natively too).
  c.stop();
  await tick();
  assert.equal(c.useAudio().sleep, null);
  assert.equal(native.sleep, null);
  // With nothing loaded there is nothing to time.
  const calls = native.sleepCalls.length;
  c.setSleepTimer({ minutes: 10 });
  await tick();
  assert.equal(c.useAudio().sleep, null);
  assert.equal(native.sleepCalls.length, calls);
});

/* ----------------------------------- completions (B5) ----------------------------------- */

const { createCompletionsDrain, PENDING_THROTTLE_MS, MAX_ATTEMPTS } = await import("../src/audio/nativeCompletions.ts");

function fakeStore(entries) {
  const store = { items: entries.map((e) => ({ completedAt: 0, kind: "plan", ...e })), takes: 0, acks: [] };
  store.deps = {
    take: async () => {
      store.takes++;
      return { items: store.items.slice() };
    },
    ack: async (upTo) => {
      store.acks.push(upTo);
      store.items = store.items.filter((c) => c.seq > upTo);
    },
    warn: () => {},
  };
  return store;
}

test("one completion that keeps failing no longer blocks the others", async () => {
  const store = fakeStore([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
  const recorded = [];
  let now = 0;
  const d = createCompletionsDrain({
    ...store.deps,
    now: () => now,
    record: async (c) => {
      if (c.seq === 2) throw new Error("bad entry");
      recorded.push(c.seq);
    },
  });
  await d.drain();
  assert.deepEqual(store.acks, [1], "what came before the failure is acknowledged");
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    now += PENDING_THROTTLE_MS;
    await d.drain();
  }
  assert.deepEqual(store.items, [], "the bad entry is dropped after its last attempt, and the rest recorded");
  assert.deepEqual(recorded, [1, 3]);
});

test("a burst of 'completions waiting' events drains at most twice", async () => {
  const store = fakeStore([{ seq: 7 }]);
  let now = 1_000_000;
  let recordCalls = 0;
  const d = createCompletionsDrain({ ...store.deps, now: () => now, record: async () => void recordCalls++ });
  // 40 state events a second, each saying one is waiting (the old 25 ms tick).
  for (let i = 0; i < 40; i++) {
    d.onPending(1);
    now += 25;
    await Promise.resolve();
  }
  await tick();
  assert.ok(store.takes >= 1 && store.takes <= 2, `took ${store.takes} times`);
  assert.equal(recordCalls, 1);
  assert.deepEqual(store.acks, [7]);
});

/* ---------------------------------- Linux desktop (B6 B7) ---------------------------------- */

const { createDesktopEngineForTest } = await import("../src/audio/engine.ts");

function desktop() {
  const rust = {
    state: { position: 0, duration: 0, playing: false, loading: false, ended: false, error: null, generation: 0 },
    calls: [],
  };
  const invoke = async (cmd, args) => {
    rust.calls.push([cmd, args]);
    if (cmd === "desktop_audio_state") return { ...rust.state };
    if (cmd === "desktop_audio_load") {
      rust.state = { ...rust.state, generation: rust.state.generation + 1, loading: true, ended: false, error: null };
    }
    return null;
  };
  const engine = createDesktopEngineForTest(invoke);
  const seen = [];
  engine.handlers = {
    onTime: (t) => seen.push(["time", t]),
    onDuration: (d) => seen.push(["duration", d]),
    onPlay: () => seen.push(["play"]),
    onPause: () => seen.push(["pause"]),
    onLoading: (b) => seen.push(["loading", b]),
    onEnded: () => seen.push(["ended"]),
  };
  return { rust, engine, seen };
}

test("desktop: the poll turns Rust's state into handler calls, only on change", async () => {
  const { rust, engine, seen } = desktop();
  engine.load({ src: "https://x/JHN/1/audio/david.mp3#t=12", title: "John 1", subtitle: "BSB · David" });
  engine.play();
  await tick();
  const load = rust.calls.find(([c]) => c === "desktop_audio_load");
  assert.deepEqual(load[1], { url: "https://x/JHN/1/audio/david.mp3", startSec: 12, title: "John 1", artist: "BSB · David" });
  assert.ok(rust.calls.findIndex(([c]) => c === "desktop_audio_play") > rust.calls.indexOf(load), "play follows load");

  rust.state = { ...rust.state, loading: false, playing: true, position: 12, duration: 300 };
  seen.length = 0;
  await engine.poll();
  assert.deepEqual(seen, [["duration", 300], ["loading", false], ["play"]]);
  seen.length = 0;
  await engine.poll();
  assert.deepEqual(seen, [], "an unchanged poll calls nothing");
  rust.state.position = 12.25;
  await engine.poll();
  assert.deepEqual(seen, [["time", 12.25]]);
  engine.release();
});

test("desktop: 'ended' and 'error' fire once per load", async () => {
  const { rust, engine, seen } = desktop();
  engine.load({ src: "https://x/a.mp3", title: "A", subtitle: "" });
  await tick();
  rust.state = { ...rust.state, loading: false, playing: false, ended: true };
  await engine.poll();
  await engine.poll();
  assert.equal(seen.filter(([e]) => e === "ended").length, 1);

  engine.load({ src: "https://x/b.mp3", title: "B", subtitle: "" });
  await tick();
  rust.state = { ...rust.state, loading: false, error: "cannot fetch audio" };
  seen.length = 0;
  await engine.poll();
  await engine.poll();
  assert.equal(seen.filter(([e]) => e === "pause").length, 1, "one error, one pause");
  assert.equal(seen.filter(([e]) => e === "ended").length, 0, "the new load's generation has not ended");
  engine.release();
});

test("desktop: loads never wait for a download, so a superseded chapter does not hold up the next", async () => {
  // Rust's desktop_audio_load returns at once and fetches in the background; the engine
  // must not queue later commands behind anything slow either.
  const { rust, engine } = desktop();
  for (const n of [2, 3, 4, 5, 6]) engine.load({ src: `https://x/${n}.mp3`, title: `${n}`, subtitle: "" });
  engine.play();
  await tick();
  const loads = rust.calls.filter(([c]) => c === "desktop_audio_load").map(([, a]) => a.url);
  assert.deepEqual(loads, [2, 3, 4, 5, 6].map((n) => `https://x/${n}.mp3`));
  assert.equal(rust.calls.at(-1)[0], "desktop_audio_play");
  engine.release();
});

test("desktop: the sleep timer's fade sets Rust's volume, clamped to 0–1", async () => {
  const { rust, engine } = desktop();
  engine.setVolume(0.456);
  engine.setVolume(-2);
  engine.setVolume(7);
  await tick();
  assert.deepEqual(
    rust.calls.filter(([c]) => c === "desktop_audio_volume").map(([, a]) => a),
    [{ volume: 0.46 }, { volume: 0 }, { volume: 1 }],
  );
  engine.release();
});

test("desktop: polling stops while paused and starts again with the next command", async () => {
  const { rust, engine } = desktop();
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    engine.load({ src: "https://x/a.mp3", title: "A", subtitle: "" });
    await tick();
    rust.state = { ...rust.state, loading: false, playing: false, position: 5, duration: 60 };
    now += 10_000; // past the grace period after the load
    const before = rust.calls.filter(([c]) => c === "desktop_audio_state").length;
    await engine.poll(); // paused: the poll stops itself
    await new Promise((r) => setTimeout(r, 600));
    const after = rust.calls.filter(([c]) => c === "desktop_audio_state").length;
    assert.equal(after, before + 1, "no polls while paused");
    engine.play();
    rust.state.playing = true;
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(rust.calls.filter(([c]) => c === "desktop_audio_state").length > after, "polling again after play");
  } finally {
    Date.now = realNow;
    engine.release();
  }
});

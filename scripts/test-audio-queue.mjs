/**
 * Regression tests for the Android (native-queue) path of the audio controller:
 * src/audio/controller.ts driving NativeEngine in src/audio/engine.ts.
 *
 * Run: pnpm test:audio   (or: node scripts/test-audio-queue.mjs)
 *
 * Needs Node 23.6+ (imports the TypeScript sources directly). The native plugin,
 * `@tauri-apps/api/core` and React are replaced with small in-memory stubs via a
 * module-resolution hook, so the REAL controller and engine run unchanged.
 *
 * The bug this guards: after jumping in a plan day's queue, progress ticks the native
 * player captured BEFORE `set_queue` landed (still carrying the old index) reached JS
 * and were taken as "the player advanced", so jumping BACK marked the chapters between
 * as read (and could complete the plan day), and jumping forward flicked the mini-player
 * back to the old chapter.
 */
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

const STUBS = {
  react: "data:text/javascript," + encodeURIComponent(`
    export function useSyncExternalStore(subscribe, get) {
      globalThis.__audioSubscribe?.(subscribe, get);
      return get();
    }`),
  "tauri-plugin-native-audio-api": "data:text/javascript," + encodeURIComponent(`
    export let listener = null;
    export async function initialize() {}
    export async function addStateListener(cb) { listener = cb; globalThis.__nativeEmit = cb; }
    export async function getState() { return globalThis.__native.snapshot(); }
    export async function play() {}
    export async function pause() {}
    export async function seekTo() {}
    export async function setRate() {}
    export async function setSource() {}`),
  "@tauri-apps/api/core": "data:text/javascript," + encodeURIComponent(`
    export async function invoke(cmd, args) { return globalThis.__native.invoke(cmd, args); }`),
};

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: STUBS[specifier], shortCircuit: true };
    // The audio sources import their siblings without an extension, as Vite allows.
    if (/^\.\/\w+$/.test(specifier) && context.parentURL?.includes("/src/audio/")) {
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

/** The native side: a monotonic clock, the playlist index, and a gate on set_queue. */
const native = {
  clock: 1000,
  index: 0,
  gate: Promise.resolve(),
  snapshot(index = native.index) {
    return { status: "playing", currentTime: 1, duration: 60, isPlaying: true, buffering: false, rate: 1, index, capturedAtMs: ++native.clock };
  },
  async invoke(cmd, args) {
    await native.gate; // the round trip to native takes time
    if (cmd === "plugin:native-audio|set_queue") {
      native.index = args.startIndex;
      globalThis.__nativeEmit(native.snapshot()); // setQueue() ends with emitState()
      return native.snapshot(); // ...and the command resolves with getState()
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

const tracks = [0, 1, 2, 3, 4, 5].map((i) => ({
  ho: "GEN",
  chapter: i + 1,
  src: `https://x/${i}.mp3`,
  title: `Genesis ${i + 1}`,
  subtitle: "BSB",
  planReadingIndex: i,
}));

/** Run `jumpTo(to)` with set_queue held open while `during` delivers stale ticks. */
async function jumpWithStaleTicks(to, staleIndexes) {
  let release;
  native.gate = new Promise((r) => (release = r));
  // Ticks the native player captured BEFORE set_queue ran: they carry the old index.
  const stale = staleIndexes.map((i) => native.snapshot(i));
  c.jumpTo(to);
  for (const s of stale) globalThis.__nativeEmit(s);
  release();
  await tick();
  native.gate = Promise.resolve();
  // A late duplicate of a stale tick (queued while the WebView was busy) must not win either.
  for (const s of stale) globalThis.__nativeEmit(s);
  await tick();
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
  globalThis.__nativeEmit(native.snapshot(2));
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

test("rapid jumps: only the newest set_queue's answer is applied", async () => {
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
  globalThis.__nativeEmit({ ...native.snapshot(0), status: "ended", isPlaying: false });
  assert.deepEqual(done, [0], "finishing the reading marks it complete");
  c.stop();
});

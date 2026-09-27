/**
 * Plan chapters and devotionals the native player heard to the end, collected by the app.
 *
 * Native queues every one, whoever loaded the queue (the car, the app, or the app's own
 * earlier session), because the app may not be there to hear it: swiped away, frozen in the
 * background, or holding a queue it adopted from the car. The app takes them at start, when
 * it comes back to the foreground, and when a state event says some are waiting
 * (`take_completions`), records each exactly as the guided reader and the Listen button do,
 * then acknowledges them (`ack_completions`) so native can forget them. Recording is
 * idempotent, so a chapter the app also marked itself does no harm.
 *
 * Pure (the recorder and the plugin calls are passed in), so scripts/test-audio-queue.mjs
 * can drive it. The app's wiring is in carSnapshot.ts (`useCarSync`).
 */
import type { NativeCompletion } from "./nativeAudio";

export type { NativeCompletion } from "./nativeAudio";

export interface CompletionsDeps {
  take: () => Promise<{ items: NativeCompletion[] }>;
  ack: (upTo: number) => Promise<unknown>;
  /** Record one completion. Idempotent. */
  record: (c: NativeCompletion) => Promise<void>;
  /** Clock, for tests. */
  now?: () => number;
  warn?: (message: string, error: unknown) => void;
}

/** An entry that failed this many times is acknowledged anyway (and dropped), so one bad
 *  entry cannot hold every later one back. */
export const MAX_ATTEMPTS = 3;
/** "Some are waiting" arrives with every native state event; drain at most this often
 *  because of it (start, foreground and the retry after a failure are not throttled). */
export const PENDING_THROTTLE_MS = 5_000;

export interface CompletionsDrain {
  /** Take, record and acknowledge what is waiting. Concurrent calls share one run, plus
   *  one more afterwards for anything that arrived meanwhile. */
  drain(): Promise<void>;
  /** Native says `count` are waiting: drain, at most once per PENDING_THROTTLE_MS. */
  onPending(count: number): void;
}

export function createCompletionsDrain(deps: CompletionsDeps): CompletionsDrain {
  const now = deps.now ?? Date.now;
  const warn = deps.warn ?? ((m, e) => console.warn(m, e));
  /** Failures so far by sequence number. */
  const failures = new Map<number, number>();
  let running: Promise<void> | null = null;
  let again = false;
  let lastPendingDrain = -Infinity;

  async function once(): Promise<void> {
    const { items } = await deps.take();
    if (!items?.length) return;
    // Acknowledge up to the first entry that failed and may yet succeed: acks are by
    // sequence number, so anything after it waits for the next drain (and is recorded
    // again then, which is harmless).
    let upTo = -1;
    let blocked = false;
    for (const c of [...items].sort((a, b) => a.seq - b.seq)) {
      try {
        await deps.record(c);
        failures.delete(c.seq);
      } catch (e) {
        const n = (failures.get(c.seq) ?? 0) + 1;
        failures.set(c.seq, n);
        if (n < MAX_ATTEMPTS) {
          warn(`audio: completion ${c.seq} not recorded (attempt ${n}); will retry`, e);
          blocked = true;
          break;
        }
        warn(`audio: completion ${c.seq} dropped after ${n} failed attempts`, e);
        failures.delete(c.seq);
      }
      upTo = c.seq;
    }
    if (upTo >= 0) await deps.ack(upTo);
    if (blocked) lastPendingDrain = now(); // retry on the next pending event after the throttle
  }

  function drain(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = once()
      .catch((e) => warn("audio: completions not collected", e))
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          void drain();
        }
      });
    return running;
  }

  function onPending(count: number) {
    if (count <= 0 || running) return;
    const t = now();
    if (t - lastPendingDrain < PENDING_THROTTLE_MS) return;
    lastPendingDrain = t;
    void drain();
  }

  return { drain, onPending };
}

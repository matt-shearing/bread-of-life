import type { DevotionSlot } from "@/lib/devotionalSpeech";

/**
 * The two names a spoken devotional reading goes by.
 *
 * - Its completion key in the app (`db.devotions`): "<devotional>:<MM-DD>:<index>", where
 *   the index is the reading's position in its day (0 = Morning, 1 = Evening).
 * - Its id in the car's Devotional tab (and so in native's `dev/…` media id):
 *   "<devotional>:<MM-DD>:m" or ":e".
 *
 * Native records a car devotional heard to the end by the second; the app marks it done by
 * the first. Pure, so scripts/test-devotional-speech.mjs can check the round trip.
 */

export function devotionDoneId(devotionalId: string, day: string, index: number): string {
  return `${devotionalId}:${day}:${index}`;
}

export function carDevotionalId(devotionalId: string, day: string, slot: DevotionSlot): string {
  return `${devotionalId}:${day}:${slot === "morning" ? "m" : "e"}`;
}

/** Split a car devotional id back into its parts, or null when it is not one. */
export function parseCarDevotionalId(carId: string): { devotionalId: string; day: string; slot: DevotionSlot } | null {
  const m = /^(.+):(\d{2}-\d{2}):([me])$/.exec(carId);
  return m ? { devotionalId: m[1], day: m[2], slot: m[3] === "m" ? "morning" : "evening" } : null;
}

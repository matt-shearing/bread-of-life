import type { PlanProgress } from "./index";

/**
 * Merge two copies of one plan's progress, day by day.
 *
 * A plan's progress syncs as one row, and whole-row last-write-wins lost ticks: day 5
 * finished on the phone in the car and day 6 on the desktop, both offline, came back as
 * one or the other. Merging per day keeps both.
 *
 * For each day, the copy whose `dayAt[day]` is newer wins that day outright: whether it
 * is done, its ticked readings and its completion time. That is what lets un-ticking a
 * day (the guided reader can) beat an older tick from another device. Where neither copy
 * has a stamp for the day (both written before v0.5), the day is done if either copy says
 * so and its ticked readings are the union; a stamp-less day never un-completes anything.
 *
 * Pure and symmetric apart from exact ties, where `a` wins.
 */
export function mergePlans(a: PlanProgress, b: PlanProgress): PlanProgress {
  const days = new Set<number>();
  for (const p of [a, b]) {
    for (const d of p.completedDays ?? []) days.add(Number(d));
    for (const d of Object.keys(p.chapterProgress ?? {})) days.add(Number(d));
    for (const d of Object.keys(p.completedAt ?? {})) days.add(Number(d));
    for (const d of Object.keys(p.dayAt ?? {})) days.add(Number(d));
  }

  const completed = new Set<number>();
  const chapterProgress: Record<number, number[]> = {};
  const completedAt: Record<number, number> = {};
  const dayAt: Record<number, number> = {};

  for (const d of [...days].sort((x, y) => x - y)) {
    const ta = a.dayAt?.[d];
    const tb = b.dayAt?.[d];
    const aDone = (a.completedDays ?? []).includes(d);
    const bDone = (b.completedDays ?? []).includes(d);
    if (ta != null || tb != null) {
      const w = (ta ?? -Infinity) >= (tb ?? -Infinity) ? a : b;
      if (w === a ? aDone : bDone) completed.add(d);
      if (w.chapterProgress?.[d]) chapterProgress[d] = [...w.chapterProgress[d]];
      if (w.completedAt?.[d] != null) completedAt[d] = w.completedAt[d];
      dayAt[d] = Math.max(ta ?? -Infinity, tb ?? -Infinity);
    } else {
      if (aDone || bDone) completed.add(d);
      const ticks = new Set([...(a.chapterProgress?.[d] ?? []), ...(b.chapterProgress?.[d] ?? [])]);
      if (ticks.size || a.chapterProgress?.[d] || b.chapterProgress?.[d]) chapterProgress[d] = [...ticks].sort((x, y) => x - y);
      const times = [a.completedAt?.[d], b.completedAt?.[d]].filter((t): t is number => t != null);
      if (times.length && completed.has(d)) completedAt[d] = Math.min(...times);
    }
  }

  const merged: PlanProgress = {
    ...b,
    ...a,
    startedAt: Math.min(a.startedAt ?? Infinity, b.startedAt ?? Infinity),
    completedDays: [...completed].sort((x, y) => x - y),
  };
  if (Object.keys(chapterProgress).length || a.chapterProgress || b.chapterProgress) merged.chapterProgress = chapterProgress;
  else delete merged.chapterProgress;
  if (Object.keys(completedAt).length || a.completedAt || b.completedAt) merged.completedAt = completedAt;
  else delete merged.completedAt;
  if (Object.keys(dayAt).length) merged.dayAt = dayAt;
  else delete merged.dayAt;
  if (!Number.isFinite(merged.startedAt)) merged.startedAt = Date.now();
  return merged;
}

/** Same progress, ignoring key order and the sync stamp. */
export function samePlanProgress(a: PlanProgress, b: PlanProgress): boolean {
  const strip = ({ updatedAt: _u, ...rest }: PlanProgress & { updatedAt?: number }) => rest;
  return JSON.stringify(canonical(strip(a))) === JSON.stringify(canonical(strip(b)));
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, canonical(o[k])]),
    );
  }
  return v;
}

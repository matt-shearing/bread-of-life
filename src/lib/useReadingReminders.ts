import { useEffect } from "react";
import { liveQuery } from "dexie";
import { db } from "@/db";
import { onSyncRound } from "@/db/sync";
import { useUI } from "@/store/ui";
import { maybeNotifyReading, osSchedulesReminders, reconcileReadingReminders } from "@/lib/notify";

/**
 * Keeps the daily-reading reminders in step with reality. Mount once (AppShell).
 *
 * On Android/iOS the OS holds a rolling window of one-off notifications, so the job is
 * to re-plan that window whenever something it depends on changes:
 * - app start, and the settings (switch, times) or the active plan changing;
 * - the app coming back to the foreground (the day may have rolled over);
 * - a plan day completed or a chapter read: both are Dexie writes, and so are the rows
 *   a sync pull brings in, so a reading finished on the desktop lands here too;
 * - a completed sync round, as a backstop.
 * On desktop and in a browser, it checks once a minute whether a reminder is due.
 */
export function useReadingReminders(): void {
  const notifyPlan = useUI((s) => s.notifyPlan);
  const slots = useUI((s) => s.readingReminderSlots);
  const activePlanId = useUI((s) => s.activePlanId);

  useEffect(() => {
    void reconcileReadingReminders();
  }, [notifyPlan, slots, activePlanId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reconcileReadingReminders(), 1500);
    };
    // The first emission is the current state, already covered by the effect above.
    let first = true;
    const sub = liveQuery(async () => {
      const [plans, reads] = await Promise.all([db.plans.toArray(), db.progress.orderBy("at").last()]);
      return JSON.stringify([plans.map((p) => [p.planId, p.completedDays.length, p.completedAt]), reads?.at]);
    }).subscribe({
      next: () => {
        if (first) first = false;
        else soon();
      },
      error: (e) => console.error("reading reminders: watch failed", e),
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void reconcileReadingReminders();
        void maybeNotifyReading();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const offRound = onSyncRound(soon);
    return () => {
      sub.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      offRound();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Desktop / browser: nothing is scheduled with the OS, so look every minute.
  useEffect(() => {
    if (osSchedulesReminders) return;
    void maybeNotifyReading();
    const id = setInterval(() => void maybeNotifyReading(), 60_000);
    return () => clearInterval(id);
  }, [notifyPlan, slots, activePlanId]);
}

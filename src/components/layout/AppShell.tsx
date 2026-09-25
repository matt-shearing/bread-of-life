import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { MiniPlayer } from "@/components/audio/MiniPlayer";
import { NowPlaying } from "@/components/audio/NowPlaying";
import { useUI } from "@/store/ui";
import { useAutoTheme } from "@/lib/useAutoTheme";
import { useReadingReminders } from "@/lib/useReadingReminders";
import { useCarSync } from "@/audio/car";
import { TooltipProvider } from "@/components/ui";
import { Onboarding } from "@/components/onboarding/Onboarding";
import {
  initNotificationRouting,
  maybeNotifyDevotion,
  maybeNotifyMemory,
  maybeNotifyPrayers,
  syncReminderSchedules,
} from "@/lib/notify";

export function AppShell() {
  const navigate = useNavigate();
  const resolvedTheme = useUI((s) => s.resolvedTheme);
  const notifyPrayers = useUI((s) => s.notifyPrayers);
  const notifyDevotion = useUI((s) => s.notifyDevotion);
  const devotionTime = useUI((s) => s.devotionTime);
  const notifyMemory = useUI((s) => s.notifyMemory);
  const reminderTime = useUI((s) => s.reminderTime);

  // The single writer of `resolvedTheme`: watches prefers-color-scheme in system
  // mode and the clock in sun mode. Mounted here so it lives as long as the app.
  useAutoTheme();

  // Paint from the RESOLVED theme, not the chosen mode — "system" and "sun" are
  // not colours.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  // Native app: a tapped notification deep-links to its screen.
  useEffect(() => {
    void initNotificationRouting((path) => navigate(path));
  }, [navigate]);

  // Android/iOS: keep the OS daily-reminder SCHEDULES in sync with the toggles/time
  // (fires even when closed). No-op on desktop and in a browser — the foreground
  // checks below cover app-open reminders there instead.
  useEffect(() => {
    void syncReminderSchedules({ notifyDevotion, devotionTime, notifyMemory, notifyPrayers, reminderTime });
  }, [notifyDevotion, devotionTime, notifyMemory, notifyPrayers, reminderTime]);

  // Daily-reading reminders: re-planned on start, return to the app, completion
  // (here or synced in) and settings changes; in-app checks on desktop/browser.
  useReadingReminders();

  // Android Auto: keep the car's Today tab current and collect chapters finished in the car.
  useCarSync();

  useEffect(() => {
    maybeNotifyPrayers(notifyPrayers);
  }, [notifyPrayers]);

  useEffect(() => {
    maybeNotifyMemory(notifyMemory);
  }, [notifyMemory]);

  // Devotional reminder (browser foreground): check on mount and once a minute.
  useEffect(() => {
    maybeNotifyDevotion(notifyDevotion, devotionTime);
    const id = setInterval(() => maybeNotifyDevotion(notifyDevotion, devotionTime), 60_000);
    return () => clearInterval(id);
  }, [notifyDevotion, devotionTime]);

  return (
    <TooltipProvider>
      <div className="flex h-[100dvh] w-full overflow-hidden pt-[env(safe-area-inset-top)]">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <div className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </div>
          {/* Persistent audio bar — shows only while narration is queued; sits above the mobile nav. */}
          <MiniPlayer />
        </main>
        <MobileNav />
      </div>
      {/* Opened from the mini-player; covers the page (and the bottom nav) while shown. */}
      <NowPlaying />
      <Onboarding />
    </TooltipProvider>
  );
}

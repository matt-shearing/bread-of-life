import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { useUI } from "@/store/ui";
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
  const theme = useUI((s) => s.theme);
  const notifyPrayers = useUI((s) => s.notifyPrayers);
  const notifyDevotion = useUI((s) => s.notifyDevotion);
  const devotionTime = useUI((s) => s.devotionTime);
  const notifyMemory = useUI((s) => s.notifyMemory);
  const notifyPlan = useUI((s) => s.notifyPlan);
  const reminderTime = useUI((s) => s.reminderTime);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Native app: a tapped notification deep-links to its screen.
  useEffect(() => {
    void initNotificationRouting((path) => navigate(path));
  }, [navigate]);

  // Native app: keep the OS daily-reminder SCHEDULES in sync with the toggles/time
  // (fires even when unfocused/closed). No-op in a browser — the foreground checks
  // below cover app-open reminders there instead.
  useEffect(() => {
    void syncReminderSchedules({ notifyDevotion, devotionTime, notifyMemory, notifyPrayers, notifyPlan, reminderTime });
  }, [notifyDevotion, devotionTime, notifyMemory, notifyPrayers, notifyPlan, reminderTime]);

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
        <main className="flex-1 overflow-hidden pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <Outlet />
        </main>
        <MobileNav />
      </div>
      <Onboarding />
    </TooltipProvider>
  );
}

import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { useUI } from "@/store/ui";
import { TooltipProvider } from "@/components/ui";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { maybeNotifyDevotion, maybeNotifyPrayers } from "@/lib/notify";

export function AppShell() {
  const theme = useUI((s) => s.theme);
  const notifyPrayers = useUI((s) => s.notifyPrayers);
  const notifyDevotion = useUI((s) => s.notifyDevotion);
  const devotionTime = useUI((s) => s.devotionTime);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    maybeNotifyPrayers(notifyPrayers);
  }, [notifyPrayers]);

  // Devotional reminder: check on mount and once a minute while the app is open.
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

import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useUI } from "@/store/ui";
import { TooltipProvider } from "@/components/ui";
import { maybeNotifyPrayers } from "@/lib/notify";

export function AppShell() {
  const theme = useUI((s) => s.theme);
  const notifyPrayers = useUI((s) => s.notifyPrayers);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    maybeNotifyPrayers(notifyPrayers);
  }, [notifyPrayers]);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
}

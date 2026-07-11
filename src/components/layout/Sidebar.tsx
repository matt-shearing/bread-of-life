import { NavLink } from "react-router-dom";
import {
  BookHeart,
  BookOpen,
  Brain,
  CalendarCheck,
  HandHeart,
  Home,
  Moon,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sparkles,
  Sun,
  Wheat,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import type { ReactNode } from "react";
import { db } from "@/db";
import { useUI } from "@/store/ui";
import { cn } from "@/lib/cn";
import { Button, Tooltip } from "@/components/ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: Home, end: true },
  { to: "/bible", label: "Bible", icon: BookOpen, end: false },
  { to: "/search", label: "Search", icon: Search, end: false },
  { to: "/plans", label: "Plans", icon: CalendarCheck, end: false },
  { to: "/devotional", label: "Devotional", icon: BookHeart, end: false },
  { to: "/memory", label: "Memory Lane", icon: Brain, end: false },
  { to: "/prayers", label: "Prayers", icon: HandHeart, end: false },
  { to: "/journal", label: "Journal", icon: NotebookPen, end: false },
  { to: "/companion", label: "Companion", icon: Sparkles, end: false },
];

/** Wrap a collapsed-rail control in a tooltip so labels stay discoverable. */
function MaybeTooltip({ show, label, children }: { show: boolean; label: string; children: ReactNode }) {
  return show ? <Tooltip label={label}>{children}</Tooltip> : <>{children}</>;
}

export function Sidebar() {
  const { theme, toggleTheme, sidebarCollapsed, toggleSidebar } = useUI();
  const activePrayers = useLiveQuery(() => db.prayers.where("status").equals("active").count(), [], 0);
  const collapsed = sidebarCollapsed;

  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 md:flex",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className={cn("flex items-center py-5", collapsed ? "flex-col gap-3 px-0" : "gap-2.5 px-5")}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Wheat className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="font-serif text-lg font-bold">Bread of Life</div>
            <div className="text-xs text-muted-foreground">Your daily homebase</div>
          </div>
        )}
        <MaybeTooltip show={collapsed} label="Expand sidebar">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className={collapsed ? undefined : "ml-auto"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen style={{ width: 18, height: 18 }} />
            ) : (
              <PanelLeftClose style={{ width: 18, height: 18 }} />
            )}
          </Button>
        </MaybeTooltip>
      </div>

      <nav className={cn("flex flex-1 flex-col gap-1", collapsed ? "px-2" : "px-3")}>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <MaybeTooltip key={to} show={collapsed} label={label}>
            <NavLink
              to={to}
              end={end}
              // Plain-STRING className (not a function): when collapsed, MaybeTooltip
              // wraps this in a Radix Tooltip whose asChild Slot stringifies a function
              // className (dropping every class → the old "cramped, no-highlight"
              // collapsed rail). react-router adds an `active` class we hook with
              // [&.active]: variants instead. Collapsed items keep the SAME 40px row
              // height + 18px icon as expanded, just centered without a label.
              className={cn(
                "relative flex items-center rounded-md text-sm font-medium transition-colors",
                "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                "[&.active]:bg-primary/15 [&.active]:text-primary-700 dark:[&.active]:text-primary-300",
                collapsed ? "h-10 justify-center" : "gap-3 px-3 py-2.5",
              )}
            >
              <Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
              {!collapsed && <span className="flex-1">{label}</span>}
              {label === "Prayers" &&
                activePrayers > 0 &&
                (collapsed ? (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
                ) : (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    {activePrayers}
                  </span>
                ))}
            </NavLink>
          </MaybeTooltip>
        ))}
      </nav>

      <div
        className={cn(
          "flex border-t border-border py-3",
          collapsed ? "flex-col items-center gap-1 px-2" : "items-center justify-between px-3",
        )}
      >
        <MaybeTooltip show={collapsed} label="Settings">
          <NavLink
            to="/settings"
            // Plain-string className (see the nav NavLink above): the collapsed Tooltip
            // Slot would stringify a function className. `active` class via react-router.
            className={cn(
              "flex items-center rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              "[&.active]:text-foreground",
              collapsed ? "h-10 w-10 justify-center" : "gap-2 px-3 py-2",
            )}
          >
            <Settings style={{ width: 18, height: 18 }} />
            {!collapsed && "Settings"}
          </NavLink>
        </MaybeTooltip>
        <Tooltip label={theme === "light" ? "Dark mode" : "Light mode"}>
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "light" ? (
              <Moon style={{ width: 18, height: 18 }} />
            ) : (
              <Sun style={{ width: 18, height: 18 }} />
            )}
          </Button>
        </Tooltip>
      </div>
    </aside>
  );
}

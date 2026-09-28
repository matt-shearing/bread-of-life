import { NavLink } from "react-router-dom";
import { Moon, PanelLeftClose, PanelLeftOpen, Sun, Wheat } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import type { ReactNode } from "react";
import { db } from "@/db";
import { useUI } from "@/store/ui";
import { cn } from "@/lib/cn";
import { useSidebarCollapsed } from "@/lib/layout";
import { MOD_K } from "@/lib/shortcuts";
import { Button, Tooltip } from "@/components/ui";
import { SETTINGS_NAV, SIDEBAR_NAV } from "./nav";

/** Wrap a collapsed-rail control in a tooltip so labels stay discoverable. */
function MaybeTooltip({ show, label, children }: { show: boolean; label: string; children: ReactNode }) {
  return show ? <Tooltip label={label}>{children}</Tooltip> : <>{children}</>;
}

export function Sidebar() {
  const { resolvedTheme, toggleTheme } = useUI();
  const activePrayers = useLiveQuery(() => db.prayers.where("status").equals("active").count(), [], 0);
  // Collapsed by default on the Fold and narrow windows; see src/lib/layout.ts.
  const { collapsed, toggle: toggleSidebar } = useSidebarCollapsed();

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
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </Button>
        </MaybeTooltip>
      </div>

      <nav className={cn("flex flex-1 flex-col gap-1", collapsed ? "px-2" : "px-3")}>
        {SIDEBAR_NAV.map(({ to, label, icon: Icon, end }) => (
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
                collapsed ? "h-10 justify-center [@media(pointer:coarse)]:h-11" : "gap-3 px-3 py-2.5",
              )}
            >
              <Icon size={18} className="shrink-0" aria-hidden />
              {!collapsed && <span className="flex-1">{label}</span>}
              {!collapsed && to === "/search" && (
                // Discoverability for the palette; hidden on touch screens (no keyboard).
                <kbd className="hidden rounded border border-border px-1.5 text-[10px] font-normal text-muted-foreground [@media(hover:hover)]:inline">
                  {MOD_K}
                </kbd>
              )}
              {to === "/prayers" &&
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
        <MaybeTooltip show={collapsed} label={SETTINGS_NAV.label}>
          <NavLink
            to={SETTINGS_NAV.to}
            // Plain-string className (see the nav NavLink above): the collapsed Tooltip
            // Slot would stringify a function className. `active` class via react-router.
            className={cn(
              "flex items-center rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              "[&.active]:text-foreground",
              collapsed ? "h-10 w-10 justify-center [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" : "gap-2 px-3 py-2",
            )}
          >
            <SETTINGS_NAV.icon size={18} aria-hidden />
            {!collapsed && SETTINGS_NAV.label}
          </NavLink>
        </MaybeTooltip>
        {/* A quick Light<->Dark PIN, keyed off what is on screen rather than the
            stored mode — see toggleTheme in src/store/ui.ts. Auto lives in Settings. */}
        <Tooltip label={resolvedTheme === "light" ? "Dark mode" : "Light mode"}>
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
            {resolvedTheme === "light" ? (
              <Moon size={18} />
            ) : (
              <Sun size={18} />
            )}
          </Button>
        </Tooltip>
      </div>
    </aside>
  );
}

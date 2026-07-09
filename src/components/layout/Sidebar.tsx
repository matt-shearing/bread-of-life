import { NavLink } from "react-router-dom";
import { BookOpen, HandHeart, Home, NotebookPen, Search, Settings, Moon, Sun, Wheat } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { useUI } from "@/store/ui";
import { cn } from "@/lib/cn";
import { Button, Tooltip } from "@/components/ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: Home, end: true },
  { to: "/bible", label: "Bible", icon: BookOpen, end: false },
  { to: "/search", label: "Search", icon: Search, end: false },
  { to: "/prayers", label: "Prayers", icon: HandHeart, end: false },
  { to: "/journal", label: "Journal", icon: NotebookPen, end: false },
];

export function Sidebar() {
  const { theme, toggleTheme } = useUI();
  const activePrayers = useLiveQuery(() => db.prayers.where("status").equals("active").count(), [], 0);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Wheat className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="font-serif text-lg font-bold">Bread of Life</div>
          <div className="text-xs text-muted-foreground">Your daily homebase</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/15 text-primary-700 dark:text-primary-300"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
          >
            <Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
            <span className="flex-1">{label}</span>
            {label === "Prayers" && activePrayers > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                {activePrayers}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center justify-between border-t border-border px-3 py-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              isActive && "text-foreground",
            )
          }
        >
          <Settings style={{ width: 18, height: 18 }} />
          Settings
        </NavLink>
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

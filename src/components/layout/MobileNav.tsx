import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  BookHeart,
  BookOpen,
  Brain,
  CalendarCheck,
  HandHeart,
  Home,
  Moon,
  MoreHorizontal,
  NotebookPen,
  Search,
  Settings,
  Sparkles,
  Sun,
} from "lucide-react";
import { useUI } from "@/store/ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui";
import { cn } from "@/lib/cn";

const PRIMARY = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/bible", label: "Bible", icon: BookOpen, end: false },
  { to: "/devotional", label: "Devotional", icon: BookHeart, end: false },
  { to: "/prayers", label: "Prayer", icon: HandHeart, end: false },
];

const MORE = [
  { to: "/search", label: "Search", icon: Search },
  { to: "/plans", label: "Plans", icon: CalendarCheck },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/journal", label: "Journal", icon: NotebookPen },
  { to: "/companion", label: "Companion", icon: Sparkles },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** Bottom navigation for phone-width screens. Hidden at md+ (the sidebar takes
 *  over on tablets and the unfolded fold). */
export function MobileNav() {
  const { theme, toggleTheme } = useUI();
  const [more, setMore] = useState(false);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {PRIMARY.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium",
                isActive ? "text-primary-600" : "text-muted-foreground",
              )
            }
          >
            <Icon style={{ width: 20, height: 20 }} />
            {label}
          </NavLink>
        ))}
        <button
          onClick={() => setMore(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground"
        >
          <MoreHorizontal style={{ width: 20, height: 20 }} />
          More
        </button>
      </nav>

      <Dialog open={more} onOpenChange={setMore}>
        <DialogContent className="max-w-sm">
          <DialogTitle>More</DialogTitle>
          <div className="grid grid-cols-3 gap-2">
            {MORE.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMore(false)}
                className={({ isActive }) =>
                  cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border border-border p-3 text-xs",
                    isActive ? "border-primary/40 bg-primary/5 text-primary-700 dark:text-primary-300" : "hover:bg-accent",
                  )
                }
              >
                <Icon style={{ width: 20, height: 20 }} />
                {label}
              </NavLink>
            ))}
            <button
              onClick={() => {
                toggleTheme();
                setMore(false);
              }}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-border p-3 text-xs hover:bg-accent"
            >
              {theme === "light" ? <Moon style={{ width: 20, height: 20 }} /> : <Sun style={{ width: 20, height: 20 }} />}
              {theme === "light" ? "Dark" : "Light"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

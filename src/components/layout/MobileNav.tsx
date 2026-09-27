import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Moon, MoreHorizontal, Sun } from "lucide-react";
import { useUI } from "@/store/ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NAV } from "./nav";

const PRIMARY = NAV.filter((n) => n.mobilePrimary);
const MORE = NAV.filter((n) => !n.mobilePrimary);

/** Bottom navigation for phone-width screens. Hidden at md+ (the sidebar takes
 *  over on tablets and the unfolded fold). */
export function MobileNav() {
  const { resolvedTheme, toggleTheme } = useUI();
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
                isActive ? "text-primary-700 dark:text-primary-400" : "text-muted-foreground",
              )
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
        <button
          onClick={() => setMore(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground"
        >
          <MoreHorizontal size={20} />
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
                <Icon size={20} />
                {label}
              </NavLink>
            ))}
            {/* Same quick Light<->Dark pin as the sidebar: it flips whatever is on
                screen and drops out of auto. Auto modes are set in Settings. */}
            <button
              onClick={() => {
                toggleTheme();
                setMore(false);
              }}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-border p-3 text-xs hover:bg-accent"
            >
              {resolvedTheme === "light" ? <Moon size={20} /> : <Sun size={20} />}
              {resolvedTheme === "light" ? "Dark" : "Light"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

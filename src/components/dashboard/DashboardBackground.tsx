import { useUI } from "@/store/ui";
import { cn } from "@/lib/cn";

/** The cozy countryside backdrop for the dashboard. Three modes:
 *  plain (none), still (image), animated (image with drifting clouds + a slow
 *  ken-burns drift). Day/dusk art follows the theme. */
export function DashboardBackground() {
  const { dashboardBg, theme } = useUI();
  if (dashboardBg === "plain") return null;

  const img = theme === "dark" ? "countryside-dusk" : "countryside-day";
  const animated = dashboardBg === "animated";

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className={cn("absolute inset-0 bg-cover bg-bottom", animated && "bol-bg-anim")}
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}backgrounds/${img}.webp)` }}
      />
      {animated && <div className="bol-clouds absolute inset-x-[-8%] top-0 h-1/2" />}
      {/* readability scrim — keeps text/cards legible over the scene in both themes */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/72 via-background/55 to-background/85" />
    </div>
  );
}

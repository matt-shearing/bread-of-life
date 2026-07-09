import { useUI } from "@/store/ui";
import { cn } from "@/lib/cn";

/** The cozy countryside backdrop. Rendered as a hero BAND at the top of the
 *  dashboard that fades into the solid page background, so the scene sits
 *  behind the greeting + Verse of the Day (where it feels like home) while
 *  everything lower stays fully legible. Modes: plain (none), still (image),
 *  animated (image with a slow ken-burns drift + clearly drifting clouds).
 *  Day/dusk art follows the theme. */
export function DashboardBackground() {
  const { dashboardBg, theme } = useUI();
  if (dashboardBg === "plain") return null;

  const img = theme === "dark" ? "countryside-dusk" : "countryside-day";
  const animated = dashboardBg === "animated";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] overflow-hidden" aria-hidden>
      <div
        className={cn("absolute inset-0 bg-cover bg-center", animated && "bol-bg-anim")}
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}backgrounds/${img}.webp)` }}
      />
      {animated && <div className="bol-clouds absolute inset-x-[-22%] top-4 h-56" />}
      {/* light wash for text over the sky, then a hard fade into the solid page */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/20 via-background/45 to-background" />
    </div>
  );
}

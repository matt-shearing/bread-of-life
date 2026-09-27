import type { ReactNode } from "react";
import { Ban, Image, Wind } from "lucide-react";
import { useUI } from "@/store/ui";
import { ChipGroup } from "@/components/ui";

/** Plain / Scene / Living for the dashboard backdrop (labels hide on a phone). */
export function BackgroundToggle() {
  const { dashboardBg, setDashboardBg } = useUI();
  const opt = (value: "plain" | "still" | "animated", label: string, icon: ReactNode) => ({
    value,
    icon,
    label: <span className="hidden sm:inline">{label}</span>,
    ariaLabel: `${label} background`,
    title: `${label} background`,
  });
  return (
    <ChipGroup
      variant="segmented"
      label="Dashboard background"
      value={dashboardBg}
      onValueChange={(v) => v && setDashboardBg(v)}
      className="backdrop-blur"
      options={[
        opt("plain", "Plain", <Ban size={15} aria-hidden />),
        opt("still", "Scene", <Image size={15} aria-hidden />),
        opt("animated", "Living", <Wind size={15} aria-hidden />),
      ]}
    />
  );
}

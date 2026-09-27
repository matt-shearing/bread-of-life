import { DashboardBackground } from "@/components/dashboard/DashboardBackground";
import { BackgroundToggle } from "@/components/dashboard/BackgroundToggle";
import { VerseOfTheDay } from "@/components/dashboard/VerseOfTheDay";
import { TodayCard } from "@/components/dashboard/TodayCard";
import { OnThisDay } from "@/components/dashboard/OnThisDay";
import { StatRow } from "@/components/dashboard/StatRow";
import { RecentJournal } from "@/components/dashboard/RecentJournal";
import { SyncNudge } from "@/components/dashboard/SyncNudge";
import { BackupNudge } from "@/components/dashboard/BackupNudge";
import { PageHeader } from "@/components/ui";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Home: one component per tile (src/components/dashboard/). */
export function DashboardPage() {
  return (
    <div className="relative h-full overflow-y-auto">
      <DashboardBackground />
      <div className="relative z-10 mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <PageHeader title={`${greeting()}.`} subtitle="Welcome back to your homebase." actions={<BackgroundToggle />} />
        <VerseOfTheDay />
        <TodayCard />
        <OnThisDay />
        <StatRow />
        <RecentJournal />
        <BackupNudge />
        <SyncNudge />
      </div>
    </div>
  );
}

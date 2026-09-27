import { useMemo, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, ChevronRight, Flame, HandHeart } from "lucide-react";
import { db } from "@/db";
import { refLabel } from "@/lib/osis";
import { localDayKey } from "@/lib/day";
import { readingStreak } from "@/lib/streak";
import { useReadingDays } from "@/lib/useReadingDays";
import { useUI } from "@/store/ui";
import { cn } from "@/lib/cn";

/**
 * The quiet row under Today: where you left off, your streak (opens Reading history),
 * and your prayer counts. Each tile is one link or button (A8). The grid fills as many
 * ~14rem columns as fit, so on the Fold the streak's week never spills out (B8).
 */
export function StatRow() {
  return (
    <div className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
      <ContinueReading />
      <StreakTile />
      <PrayerStats />
    </div>
  );
}

const TILE =
  "group flex w-full flex-col rounded-lg border border-border bg-card/90 p-4 text-left text-card-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function TileLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      <span className="flex-1">{children}</span>
      <ChevronRight size={14} className="opacity-50 group-hover:opacity-100" aria-hidden />
    </div>
  );
}

function ContinueReading() {
  const navigate = useNavigate();
  const { goTo, readingPos, setReturnTo } = useUI();
  const progress = useLiveQuery(() => db.progress.orderBy("at").reverse().toArray(), [], []);
  // "Continue reading" is YOUR place: the Bible tab's saved position, or (from another
  // device, via sync) the newest progress row read on a Bible page. Plan chapters are
  // written with lastVerse 0 and skipped, so a plan never moves this card.
  const lastRead = useMemo(() => {
    const row = (progress ?? []).find((p) => p.lastVerse >= 1);
    const fromRow = row ? { ho: row.ho, chapter: row.chapter, verse: row.lastVerse, at: row.at } : null;
    if (readingPos && (!fromRow || readingPos.at >= fromRow.at)) return readingPos;
    return fromRow;
  }, [progress, readingPos]);

  return (
    <button
      type="button"
      className={TILE}
      onClick={() => {
        setReturnTo(null);
        if (lastRead) goTo(lastRead.ho, lastRead.chapter, lastRead.verse, { flash: false });
        navigate("/bible");
      }}
    >
      <TileLabel icon={<BookOpen size={14} aria-hidden />}>{lastRead ? "Continue reading" : "Start reading"}</TileLabel>
      <div className="font-serif text-lg font-bold">
        {lastRead ? refLabel(lastRead.ho, lastRead.chapter, lastRead.verse > 1 ? lastRead.verse : undefined) : "John 1"}
      </div>
    </button>
  );
}

function StreakTile() {
  const readDays = useReadingDays();
  const streak = useMemo(() => readingStreak(readDays).days, [readDays]);
  const weekDots = useMemo(() => {
    const out: { label: string; active: boolean; today: boolean; name: string }[] = [];
    const d = new Date();
    d.setDate(d.getDate() - 6);
    const todayKey = localDayKey();
    for (let i = 0; i < 7; i++) {
      const key = localDayKey(d.getTime());
      out.push({
        label: d.toLocaleDateString(undefined, { weekday: "narrow" }),
        name: d.toLocaleDateString(undefined, { weekday: "long" }),
        active: readDays.has(key),
        today: key === todayKey,
      });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [readDays]);
  const readThisWeek = weekDots.filter((d) => d.active).length;

  return (
    // The Reading history page (/history) holds the full calendar.
    <Link to="/history" className={TILE} aria-label={`Reading streak: ${streak} ${streak === 1 ? "day" : "days"}, read on ${readThisWeek} of the last 7 days. Open reading history.`}>
      <TileLabel icon={<Flame size={14} aria-hidden />}>Reading streak</TileLabel>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="text-lg font-bold">
          {streak} {streak === 1 ? "day" : "days"}
        </div>
        <div className="flex gap-1" aria-hidden>
          {weekDots.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5" title={d.name}>
              <div
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[9px]",
                  d.active
                    ? "bg-primary text-primary-foreground"
                    : d.today
                      ? "border-2 border-dashed border-primary/60"
                      : "border border-border",
                )}
              >
                {d.active ? "✓" : ""}
              </div>
              <span className="text-[10px] text-muted-foreground">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

function PrayerStats() {
  const counts = useLiveQuery(
    async () => ({
      active: await db.prayers.where("status").equals("active").count(),
      answered: await db.prayers.where("status").equals("answered").count(),
    }),
    [],
    { active: 0, answered: 0 },
  );
  return (
    <Link to="/prayers" className={TILE}>
      <TileLabel icon={<HandHeart size={14} aria-hidden />}>Prayers</TileLabel>
      <div className="flex items-baseline gap-4">
        <div>
          <span className="text-lg font-bold">{counts.active}</span>{" "}
          <span className="text-xs text-muted-foreground">active</span>
        </div>
        <div>
          <span className="text-lg font-bold text-success">{counts.answered}</span>{" "}
          <span className="text-xs text-muted-foreground">answered</span>
        </div>
      </div>
    </Link>
  );
}

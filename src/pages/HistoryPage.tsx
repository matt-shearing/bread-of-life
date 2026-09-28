import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, CalendarCheck, Headphones } from "lucide-react";
import { db, type ReadingLogEntry, type ReadingSource } from "@/db";
import { loadIndex } from "@/data/bible";
import { BOOKS, refLabel } from "@/lib/osis";
import { localDayKey, yesterdayKey } from "@/lib/day";
import { longestStreak, readingStreak } from "@/lib/streak";
import {
  bookProgress,
  chaptersInPeriod,
  chaptersPerDay,
  heatmapWeeks,
  intensity,
  recentDays,
  type BookProgress,
} from "@/lib/readingHistory";
import { useUI } from "@/store/ui";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Reading history: a quiet look back over the reading log (src/db/readingLog.ts) — a
 * year of days, the streak, this month and year, how much of each book, and the most
 * recent readings.
 */

const SHADES = [
  "bg-muted",
  "bg-primary-200 dark:bg-primary-900",
  "bg-primary-300 dark:bg-primary-700",
  "bg-primary-500 dark:bg-primary-500",
  "bg-primary-700 dark:bg-primary-300",
] as const;

export function HistoryPage() {
  const log = useLiveQuery(() => db.readingLog.toArray(), [], undefined);
  const progress = useLiveQuery(() => db.progress.toArray(), [], undefined);
  const [books, setBooks] = useState<{ ho: string; chapters: number }[] | null>(null);

  useEffect(() => {
    loadIndex()
      .then((idx) => setBooks(idx.map((b) => ({ ho: b.id, chapters: b.chapters }))))
      .catch(() => setBooks([]));
  }, []);

  const now = Date.now();
  const todayKey = localDayKey(now);

  const stats = useMemo(() => {
    if (!log || !progress) return null;
    const progressDays = progress.map((p) => localDayKey(p.at));
    const perDay = chaptersPerDay(log, progressDays);
    const days = new Set(perDay.keys());
    return {
      perDay,
      streak: readingStreak(days, now),
      longest: longestStreak(days),
      month: chaptersInPeriod(log, "month", now),
      year: chaptersInPeriod(log, "year", now),
      daysThisYear: [...days].filter((d) => d.startsWith(todayKey.slice(0, 4))).length,
    };
    // `now` only matters per day; recompute when the day key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, progress, todayKey]);

  if (!stats || !log || !progress) {
    return <div className="p-10 text-center text-muted-foreground">Gathering your reading…</div>;
  }

  const empty = stats.perDay.size === 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <header className="mb-6">
          <h1 className="font-serif text-3xl font-bold">Reading history</h1>
          <p className="text-muted-foreground">Every day you have opened the Word, kept.</p>
        </header>

        {empty ? (
          <EmptyHistory />
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="history-stats">
              <Stat label="Current streak" value={stats.streak.days} unit="day" hint={stats.streak.days > 0 && !stats.streak.includesToday ? "Read today to keep it" : undefined} />
              <Stat label="Longest streak" value={stats.longest} unit="day" />
              <Stat label="This month" value={stats.month} unit="chapter" />
              <Stat label="This year" value={stats.year} unit="chapter" hint={`${stats.daysThisYear} ${stats.daysThisYear === 1 ? "day" : "days"} of reading`} />
            </div>

            <YearHeatmap perDay={stats.perDay} now={now} />

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <BooksGrid books={books} log={log} progress={progress} />
              </div>
              <div className="lg:col-span-2">
                <RecentReading log={log} todayKey={todayKey} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, hint }: { label: string; value: number; unit: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-nowrap text-2xl font-bold tabular-nums">
        {value} <span className="text-sm font-medium text-muted-foreground">{value === 1 ? unit : `${unit}s`}</span>
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function EmptyHistory() {
  const navigate = useNavigate();
  return (
    <Card className="p-8 text-center">
      <BookOpen style={{ width: 28, height: 28 }} className="mx-auto text-primary-500" />
      <p className="mx-auto mt-3 max-w-sm text-muted-foreground">
        Your reading will gather here, day by day: each chapter you read, a plan day you finish, or a chapter you
        listen to.
      </p>
      <Button className="mt-4" variant="outline" onClick={() => navigate("/bible")}>
        Open the reader
      </Button>
    </Card>
  );
}

/* ---------------------------------- heat-map ---------------------------------- */

const CELL = 12; // px, the square
const GAP = 3;

function YearHeatmap({ perDay, now }: { perDay: Map<string, number>; now: number }) {
  const weeks = useMemo(() => heatmapWeeks(perDay, now), [perDay, now]);
  const scroller = useRef<HTMLDivElement>(null);
  // On a narrow screen the year scrolls sideways; start at the recent end.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks.length]);
  const fmt = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };
  const days = [...perDay.entries()].filter(([k]) => k >= weeks[0].cells[0].key).length;

  return (
    <Card className="p-5" data-testid="history-heatmap">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-semibold">The past year</h2>
        <span className="text-sm text-muted-foreground">
          {days} {days === 1 ? "day" : "days"} with reading
        </span>
      </div>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div className="inline-flex gap-2">
          {/* Weekday labels */}
          <div className="flex flex-col pt-[18px] text-[10px] leading-none text-muted-foreground" style={{ gap: GAP }} aria-hidden>
            {["", "Mon", "", "Wed", "", "Fri", ""].map((l, i) => (
              <div key={i} style={{ height: CELL }} className="flex items-center">
                {l}
              </div>
            ))}
          </div>
          <div role="grid" aria-label="Chapters read each day over the past year">
            <div className="relative mb-1.5 h-3 text-[10px] leading-none text-muted-foreground" aria-hidden>
              {weeks.map((w, i) =>
                w.monthLabel ? (
                  <span key={i} className="absolute" style={{ left: i * (CELL + GAP) }}>
                    {w.monthLabel}
                  </span>
                ) : null,
              )}
            </div>
            <div className="flex" style={{ gap: GAP }}>
              {weeks.map((w, i) => (
                <div key={i} role="row" className="flex flex-col" style={{ gap: GAP }}>
                  {w.cells.map((c) => {
                    const label = c.future
                      ? ""
                      : `${fmt(c.key)}: ${c.count ? `${c.count} ${c.count === 1 ? "chapter" : "chapters"}` : "no reading"}`;
                    return (
                      <div
                        key={c.key}
                        role="gridcell"
                        title={label || undefined}
                        aria-label={label || undefined}
                        data-count={c.count}
                        className={cn("rounded-[3px]", c.future ? "bg-transparent" : SHADES[intensity(c.count)])}
                        style={{ width: CELL, height: CELL }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground" aria-hidden>
        Less
        {SHADES.map((s, i) => (
          <span key={i} className={cn("inline-block rounded-[3px]", s)} style={{ width: CELL - 2, height: CELL - 2 }} />
        ))}
        More
      </div>
    </Card>
  );
}

/* ------------------------------------ books ------------------------------------ */

function BooksGrid({
  books,
  log,
  progress,
}: {
  books: { ho: string; chapters: number }[] | null;
  log: ReadingLogEntry[];
  progress: { ho: string; chapter: number }[];
}) {
  const rows = useMemo(() => {
    if (!books) return null;
    const counts = new Map(books.map((b) => [b.ho, b.chapters]));
    const meta = BOOKS.filter((b) => counts.has(b.ho)).map((b) => ({
      ho: b.ho,
      name: b.name,
      testament: b.testament,
      chapters: counts.get(b.ho)!,
    }));
    return bookProgress(meta, [...log, ...progress]);
  }, [books, log, progress]);

  const total = rows?.reduce((n, b) => n + b.total, 0) ?? 0;
  const read = rows?.reduce((n, b) => n + b.read, 0) ?? 0;

  return (
    <Card className="p-5" data-testid="history-books">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-semibold">Through the Bible</h2>
        {rows && total > 0 && (
          <span className="text-sm text-muted-foreground">
            {read} of {total} chapters read at least once
          </span>
        )}
      </div>
      {!rows ? (
        <div className="text-sm text-muted-foreground">Loading the books…</div>
      ) : (
        <div className="space-y-4">
          {(["OT", "NT"] as const).map((t) => (
            <div key={t}>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t === "OT" ? "Old Testament" : "New Testament"}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                {rows.filter((b) => b.testament === t).map((b) => (
                  <BookRow key={b.ho} b={b} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function BookRow({ b }: { b: BookProgress }) {
  const pct = b.total ? (b.read / b.total) * 100 : 0;
  const done = b.read > 0 && b.read === b.total;
  return (
    <div
      className="min-w-0"
      title={`${b.name}: ${b.read} of ${b.total} ${b.total === 1 ? "chapter" : "chapters"}`}
      data-book={b.ho}
      data-read={b.read}
    >
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={cn("truncate", b.read ? "text-foreground" : "text-muted-foreground")}>{b.name}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {b.read}/{b.total}
        </span>
      </div>
      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", done ? "bg-primary-600 dark:bg-primary-400" : "bg-primary-400 dark:bg-primary-600")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------ recent ----------------------------------- */

const SOURCE: Record<ReadingSource, { icon: typeof BookOpen; label: string }> = {
  reader: { icon: BookOpen, label: "Read" },
  plan: { icon: CalendarCheck, label: "Reading plan" },
  audio: { icon: Headphones, label: "Listened" },
};

function RecentReading({ log, todayKey }: { log: ReadingLogEntry[]; todayKey: string }) {
  const navigate = useNavigate();
  const goTo = useUI((s) => s.goTo);
  const days = useMemo(() => recentDays(log, 8), [log]);
  const yKey = yesterdayKey();
  const dayLabel = (k: string) => {
    if (k === todayKey) return "Today";
    if (k === yKey) return "Yesterday";
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      ...(String(y) === todayKey.slice(0, 4) ? {} : { year: "numeric" }),
    });
  };

  return (
    <Card className="p-5" data-testid="history-recent">
      <h2 className="mb-3 font-semibold">Recent reading</h2>
      {days.length === 0 ? (
        <div className="text-sm text-muted-foreground">Nothing recorded yet.</div>
      ) : (
        <ol className="space-y-3">
          {days.map(({ dayKey, chapters }) => (
            <li key={dayKey}>
              <div className="mb-1 text-xs font-medium text-muted-foreground">{dayLabel(dayKey)}</div>
              <div className="flex flex-wrap gap-1.5">
                {chapters.map((c) => {
                  const S = SOURCE[c.source] ?? SOURCE.reader;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        goTo(c.ho, c.chapter);
                        navigate("/bible");
                      }}
                      title={`${S.label} · ${new Date(c.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm hover:border-primary/40 hover:bg-accent [@media(pointer:coarse)]:min-h-11"
                    >
                      <S.icon style={{ width: 13, height: 13 }} className="text-primary-700 dark:text-primary-400" aria-label={S.label} />
                      {refLabel(c.ho, c.chapter)}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

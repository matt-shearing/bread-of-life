import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronsRight,
  Gauge,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import {
  canSetRate,
  jumpTo,
  next,
  prev,
  seekBy,
  seekTo,
  setRate,
  toggle,
  useAudio,
  type Track,
} from "@/audio/controller";
import { groupDayReadings, type ReadingGroup } from "@/audio/readingGroups";
import { getAnyPlan, type Plan } from "@/data/plans";
import { db } from "@/db";
import { bookByHo, refRange } from "@/lib/osis";
import { useUI } from "@/store/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Now Playing — the full view behind the mini-player. A full-screen sheet on a phone
 * (one column) and on a fold's unfolded inner screen or a small tablet (two columns:
 * player beside the day's list); swipe it down, press back, or tap the chevron to
 * close. On a large screen it is a centred panel over the dimmed page.
 *
 * It is an overlay, not a route. Opening it pushes `?np=1` onto the CURRENT location,
 * so the Android back button and browser back close it, while the page underneath
 * stays mounted — the guided reader keeps its place and its leave-guard (which watches
 * the pathname) is not tripped by opening the player.
 */

const PARAM = "np";
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** Open the Now Playing sheet over whatever page is showing. */
export function useOpenNowPlaying() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    const params = new URLSearchParams(location.search);
    if (params.get(PARAM) === "1") return;
    params.set(PARAM, "1");
    navigate({ pathname: location.pathname, search: `?${params}` }, { state: { npPushed: true } });
  }, [navigate, location.pathname, location.search]);
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(ss).padStart(2, "0")}`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Below `lg` the player is a full-screen sheet (phones, and a fold's near-square inner
 *  screen, where a dimmed page around a floating panel only wastes room); from `lg` up
 *  it is a floating panel. The sheet swipes down to close. */
function isSheetLayout(): boolean {
  return typeof window !== "undefined" && !window.matchMedia?.("(min-width: 1024px)").matches;
}

/** Below `md` the player and the list share one scroller (single column). */
function isPhoneWidth(): boolean {
  return typeof window !== "undefined" && !window.matchMedia?.("(min-width: 768px)").matches;
}

/* ================================== sheet ================================== */

export function NowPlaying() {
  const location = useLocation();
  const navigate = useNavigate();
  const audio = useAudio();
  const track = audio.queue[audio.index];
  const open = new URLSearchParams(location.search).get(PARAM) === "1";

  const close = useCallback(() => {
    if ((location.state as { npPushed?: boolean } | null)?.npPushed) {
      navigate(-1);
    } else {
      // Arrived with ?np=1 already in the URL (a reload): drop it in place.
      const params = new URLSearchParams(location.search);
      params.delete(PARAM);
      const search = params.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });
    }
  }, [location.state, location.search, location.pathname, navigate]);

  // Nothing playing any more (the mini-player's ✕, or the queue was cleared): close.
  useEffect(() => {
    if (open && !track) close();
  }, [open, track, close]);

  if (!open || !track) return null;
  return <NowPlayingSheet track={track} onClose={close} />;
}

function NowPlayingSheet({ track, onClose }: { track: Track; onClose: () => void }) {
  const { queue, index, playing, loading } = useAudio();
  const navigate = useNavigate();
  const goTo = useUI((s) => s.goTo);
  const closeRef = useRef<HTMLButtonElement>(null);

  const isDay = track.planId != null && track.planDay != null;
  const day = useDayReadings(isDay ? track.planId! : null, isDay ? track.planDay! : null);

  // Escape closes; focus lands on the close control and returns on the way out.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  const drag = useSwipeDown(onClose);

  // "Next reading": the first track of the next passage that has narration.
  const nextReadingIndex = useMemo(() => {
    if (!isDay || track.readingGroup == null) return -1;
    return queue.findIndex(
      (t, i) =>
        i > index &&
        t.planId === track.planId &&
        t.planDay === track.planDay &&
        t.readingGroup != null &&
        t.readingGroup > track.readingGroup!,
    );
  }, [isDay, queue, index, track]);

  function openInReader() {
    if (isDay) {
      const r = track.planReadingIndex != null ? `?reading=${track.planReadingIndex}` : "";
      navigate(`/guided/${track.planId}/${track.planDay}${r}`, { replace: true });
    } else {
      goTo(track.ho, track.chapter);
      navigate("/bible", { replace: true });
    }
  }

  const book = bookByHo(track.ho);
  const group = day.groups?.[track.readingGroup ?? -1];
  const context = isDay
    ? [day.plan?.name, `Day ${(track.planDay ?? 0) + 1}`].filter(Boolean).join(" · ")
    : track.subtitle;
  const hasList = isDay ? (day.groups?.length ?? 0) > 0 : queue.length > 1;

  return (
    <div
      className="fixed inset-0 z-40 lg:flex lg:items-center lg:justify-center lg:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${track.title}`}
    >
      {/* Backdrop — only visible (and clickable) around the desktop panel. */}
      <div
        className="absolute inset-0 hidden bg-black/40 backdrop-blur-sm motion-safe:animate-fade-in lg:block"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={drag.sheetRef}
        className={cn(
          "relative flex h-full w-full flex-col overflow-hidden bg-background",
          "motion-safe:animate-sheet-up lg:motion-safe:animate-panel-in",
          "lg:h-[min(720px,calc(100dvh-4rem))] lg:rounded-2xl lg:border lg:border-border lg:shadow-2xl",
          hasList ? "lg:max-w-5xl" : "lg:max-w-md",
        )}
      >
        {/* Warm amber glow from the top — the app's primary, nothing new. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[55%] bg-[radial-gradient(ellipse_80%_70%_at_50%_0%,hsl(var(--primary)/0.20),transparent_70%)] dark:bg-[radial-gradient(ellipse_80%_70%_at_50%_0%,hsl(var(--primary)/0.14),transparent_70%)]"
          aria-hidden="true"
        />

        {/* Top bar: the grab handle + close. Dragging here pulls the sheet down. */}
        <div
          className="relative shrink-0 touch-none select-none px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] lg:touch-auto lg:pt-3"
          {...drag.handleProps}
        >
          <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30 lg:hidden" aria-hidden="true" />
          <div className="flex items-center gap-2">
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close Now Playing"
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className="lg:hidden" style={{ width: 24, height: 24 }} />
              <X className="hidden lg:block" style={{ width: 20, height: 20 }} />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-700 dark:text-primary-300">
                {isDay ? "Daily reading" : "Now playing"}
              </div>
              <div className="truncate text-xs text-muted-foreground">{context}</div>
            </div>
            <button
              onClick={openInReader}
              aria-label={isDay ? "Open today's reading" : `Open ${track.title} in the Bible`}
              title={isDay ? "Open today's reading" : "Open in the Bible"}
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BookOpen style={{ width: 20, height: 20 }} />
            </button>
          </div>
        </div>

        <div
          data-np-scroll
          className={cn(
            "relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+1rem)]",
            hasList && "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:overflow-hidden lg:pb-0",
          )}
        >
          {/* ------------------------------- player ------------------------------ */}
          <section className="flex flex-col items-center px-6 pb-6 pt-2 md:justify-center md:overflow-y-auto md:px-10 md:py-8">
            <Cover
              bookName={book?.name ?? track.ho}
              chapter={track.chapter}
              kicker={group?.kicker ?? (book?.testament === "NT" ? "New Testament" : "Old Testament")}
              playing={playing}
              {...drag.handleProps}
            />

            <div className="mt-6 w-full max-w-sm text-center">
              <h2 className="font-serif text-2xl font-bold leading-tight">{track.title}</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {isDay && group && group.items.length > 1 ? `${group.label} · ` : ""}
                {track.subtitle}
              </p>
            </div>

            <Scrubber />

            {/* Transport */}
            <div className="mt-4 flex w-full max-w-sm items-center justify-between">
              <RoundButton label="Back 10 seconds" onClick={() => seekBy(-10)}>
                <SkipIcon dir="back" n={10} />
              </RoundButton>
              <RoundButton label="Previous chapter" onClick={prev}>
                <SkipBack style={{ width: 24, height: 24 }} fill="currentColor" />
              </RoundButton>
              <button
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play"}
                className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:active:scale-95"
              >
                {loading ? (
                  <Loader2 className="motion-safe:animate-spin" style={{ width: 30, height: 30 }} />
                ) : playing ? (
                  <Pause style={{ width: 30, height: 30 }} fill="currentColor" />
                ) : (
                  <Play className="translate-x-0.5" style={{ width: 30, height: 30 }} fill="currentColor" />
                )}
              </button>
              <RoundButton label="Next chapter" onClick={next} disabled={index >= queue.length - 1}>
                <SkipForward style={{ width: 24, height: 24 }} fill="currentColor" />
              </RoundButton>
              <RoundButton label="Forward 30 seconds" onClick={() => seekBy(30)}>
                <SkipIcon dir="forward" n={30} />
              </RoundButton>
            </div>

            {/* Secondary: speed + next reading */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {canSetRate && <SpeedControl />}
              {isDay && (
                <button
                  onClick={() => nextReadingIndex >= 0 && jumpTo(nextReadingIndex)}
                  disabled={nextReadingIndex < 0}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card/70 px-3.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45"
                >
                  <ChevronsRight style={{ width: 17, height: 17 }} className="text-primary-600 dark:text-primary-400" />
                  Next reading
                </button>
              )}
            </div>
          </section>

          {/* -------------------------------- list ------------------------------- */}
          {hasList && (
            <section className="border-t border-border/70 md:overflow-y-auto md:border-l md:border-t-0 md:bg-card/40">
              {isDay ? (
                <DayList track={track} day={day} />
              ) : (
                <UpNextList queue={queue} index={index} />
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================= pieces ================================== */

/** The "artwork": a warm book-cover card with the book and a large chapter numeral. */
function Cover({
  bookName,
  chapter,
  kicker,
  playing,
  ...rest
}: {
  bookName: string;
  chapter: number;
  kicker: string;
  playing: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="relative aspect-square w-full max-w-[clamp(7.5rem,calc(100dvh-26rem),18rem)] touch-none select-none md:max-w-[clamp(10rem,calc(100dvh-25rem),22rem)] lg:max-w-[18rem] lg:touch-auto"
      {...rest}
    >
      <div
        className={cn(
          "absolute inset-0 rounded-[28px] bg-primary/25 blur-2xl transition-opacity duration-700 dark:bg-primary/20",
          playing ? "opacity-100" : "opacity-40",
        )}
        aria-hidden="true"
      />
      <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-[28px] border border-primary-200/70 bg-gradient-to-br from-primary-50 via-primary-100 to-primary-200 text-primary-900 shadow-xl dark:border-primary-500/20 dark:from-[hsl(30_22%_17%)] dark:via-[hsl(28_20%_14%)] dark:to-[hsl(26_18%_11%)] dark:text-primary-100">
        <BookOpen
          className="absolute -bottom-6 -right-6 text-primary-600/10 dark:text-primary-300/10"
          style={{ width: 150, height: 150 }}
          aria-hidden="true"
        />
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-700/80 dark:text-primary-300/80">
          {kicker}
        </div>
        <div className="mt-2 px-4 text-center font-serif text-xl font-bold leading-tight">{bookName}</div>
        <div className="mt-1 font-serif text-[5.5rem] font-bold leading-none tabular-nums text-primary-700 dark:text-primary-400">
          {chapter}
        </div>
        <div className="mt-3 h-4">{playing && <EqBars className="text-primary-600 dark:text-primary-400" />}</div>
      </div>
    </div>
  );
}

function EqBars({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-4 items-end gap-[3px]", className)} aria-hidden="true">
      {[0, 180, 360, 90].map((d) => (
        <span
          key={d}
          className="h-full w-[3px] origin-bottom rounded-full bg-current motion-safe:animate-np-bar motion-reduce:scale-y-75"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );
}

function RoundButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-12 w-12 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** A circular-arrow icon with the jump size written inside it. */
function SkipIcon({ dir, n }: { dir: "back" | "forward"; n: number }) {
  const Icon = dir === "back" ? RotateCcw : RotateCw;
  return (
    <span className="relative flex items-center justify-center">
      <Icon style={{ width: 28, height: 28 }} strokeWidth={1.75} />
      <span className="absolute pt-[2px] text-[9px] font-bold tabular-nums">{n}</span>
    </span>
  );
}

/** Large scrubber: drag or click to seek, arrow keys ±5 s. Shows elapsed and remaining. */
function Scrubber() {
  const { currentTime, duration } = useAudio();
  const barRef = useRef<HTMLDivElement>(null);
  const [dragAt, setDragAt] = useState<number | null>(null);
  const shown = dragAt ?? currentTime;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;

  const timeAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragAt(timeAt(e.clientX));
  }
  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragAt === null) return;
    setDragAt(timeAt(e.clientX));
  }
  function onUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragAt === null) return;
    seekTo(timeAt(e.clientX));
    setDragAt(null);
  }

  return (
    <div className="mt-6 w-full max-w-sm">
      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${fmt(shown)} of ${fmt(duration)}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDragAt(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") seekBy(-5);
          else if (e.key === "ArrowRight") seekBy(5);
          else return;
          e.preventDefault();
        }}
        className="group relative flex h-8 cursor-pointer touch-none items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/10 transition-[height] group-hover:h-2">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <div
          className={cn(
            "absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-md transition-transform",
            dragAt !== null ? "scale-125" : "scale-100",
          )}
          style={{ left: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="mt-1 flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{fmt(shown)}</span>
        <span>{duration > 0 ? `-${fmt(duration - shown)}` : "--:--"}</span>
      </div>
    </div>
  );
}

function SpeedControl() {
  const { rate } = useAudio();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={`Playback speed ${rate}×`}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card/70 px-3.5 text-sm font-medium tabular-nums shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Gauge style={{ width: 16, height: 16 }} className="text-primary-600 dark:text-primary-400" />
          {rate}×
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-1.5" side="top">
        <div className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Speed</div>
        <div className="mt-1 grid grid-cols-3 gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setRate(s);
                setOpen(false);
              }}
              aria-pressed={s === rate}
              className={cn(
                "h-9 min-w-14 rounded-md px-2 text-sm font-medium tabular-nums transition-colors",
                s === rate ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {s}×
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ============================== day's readings ============================== */

interface DayData {
  plan: Plan | null | undefined;
  groups: ReadingGroup[] | null;
  readings: { ho: string; chapter: number; vStart?: number; vEnd?: number }[];
  done: Set<number>;
}

/** The plan day behind the queue, its passages, and which plan readings are done (live). */
function useDayReadings(planId: string | null, day: number | null): DayData {
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  useEffect(() => {
    if (!planId) return;
    let alive = true;
    getAnyPlan(planId).then((p) => alive && setPlan(p ?? null));
    return () => {
      alive = false;
    };
  }, [planId]);

  // Live: narration marks each chapter read as it finishes, and this list follows.
  const progress = useLiveQuery(() => (planId ? db.plans.get(planId) : undefined), [planId]);

  return useMemo(() => {
    const readings = plan && day != null ? (plan.days[day] ?? []) : [];
    const groups = readings.length ? groupDayReadings(readings) : null;
    const done = new Set<number>();
    if (day != null && progress) {
      if (progress.completedDays?.includes(day)) readings.forEach((_, i) => done.add(i));
      for (const i of progress.chapterProgress?.[day] ?? []) done.add(i);
    }
    return { plan, groups, readings, done };
  }, [plan, day, progress]);
}

type RowStatus = "playing" | "done" | "next" | "later" | "unread";

function DayList({ track, day }: { track: Track; day: DayData }) {
  const { queue, index } = useAudio();
  const groups = day.groups ?? [];
  const cur = track.readingGroup ?? -1;
  const doneCount = groups.filter((g) => g.items.every((i) => day.done.has(i))).length;
  const listRef = useScrollCurrentIntoView(cur);

  // First queue index for each passage (only tracks from this same plan day).
  const firstTrack = useMemo(() => {
    const m = new Map<number, number>();
    queue.forEach((t, i) => {
      if (t.planId !== track.planId || t.planDay !== track.planDay || t.readingGroup == null) return;
      if (!m.has(t.readingGroup)) m.set(t.readingGroup, i);
    });
    return m;
  }, [queue, track.planId, track.planDay]);

  const firstAfter = groups.find((g) => g.index > cur && firstTrack.has(g.index))?.index;

  return (
    <div className="px-4 py-5 md:px-6 md:py-7" ref={listRef}>
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h3 className="font-serif text-lg font-bold">Today's readings</h3>
          <p className="text-xs text-muted-foreground">
            {doneCount} of {groups.length} read
          </p>
        </div>
        <div className="mb-1 flex gap-1" aria-hidden="true">
          {groups.map((g) => (
            <span
              key={g.index}
              className={cn(
                "h-1.5 w-5 rounded-full transition-colors",
                g.index === cur
                  ? "bg-primary"
                  : g.items.every((i) => day.done.has(i))
                    ? "bg-success"
                    : "bg-foreground/10",
              )}
            />
          ))}
        </div>
      </div>

      <ol className="mt-4 space-y-2">
        {groups.map((g) => {
          const allDone = g.items.every((i) => day.done.has(i));
          const status: RowStatus =
            g.index === cur
              ? "playing"
              : allDone
                ? "done"
                : g.index === firstAfter
                  ? "next"
                  : g.index > cur
                    ? "later"
                    : "unread";
          const target = firstTrack.get(g.index);
          return (
            <li key={g.index}>
              <ReadingRow
                group={g}
                status={status}
                readings={day.readings}
                done={day.done}
                playingReading={g.index === cur ? queue[index]?.planReadingIndex : undefined}
                onPlay={target != null ? () => jumpTo(target) : undefined}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const STATUS_TEXT: Record<RowStatus, string> = {
  playing: "Playing",
  done: "Read",
  next: "Up next",
  later: "",
  unread: "Not read",
};

function ReadingRow({
  group,
  status,
  readings,
  done,
  playingReading,
  onPlay,
}: {
  group: ReadingGroup;
  status: RowStatus;
  readings: DayData["readings"];
  done: Set<number>;
  playingReading: number | undefined;
  onPlay?: () => void;
}) {
  const playing = status === "playing";
  const multi = group.items.length > 1;
  const sameBook = group.items.every((i) => readings[i]?.ho === readings[group.items[0]]?.ho);
  return (
    <button
      onClick={onPlay}
      disabled={!onPlay}
      data-current={playing || undefined}
      data-status={status}
      aria-current={playing ? "true" : undefined}
      aria-label={`${group.kicker}: ${group.label}${STATUS_TEXT[status] ? `, ${STATUS_TEXT[status]}` : ""}${onPlay ? "" : ", no narration"}`}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        playing
          ? "border-primary/40 bg-primary/10 shadow-sm dark:bg-primary/[0.12]"
          : "border-transparent hover:border-border hover:bg-card",
        !onPlay && "cursor-default opacity-60",
      )}
    >
      <StatusDot status={status} n={group.index + 1} />
      <span className="min-w-0 flex-1">
        <span className="block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {group.kicker}
        </span>
        <span
          className={cn(
            "block truncate font-serif text-[15px] font-bold",
            status === "done" && "text-muted-foreground",
            playing && "text-primary-800 dark:text-primary-200",
          )}
        >
          {group.label}
        </span>
        {multi && (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {group.items.map((i) => {
              const r = readings[i];
              if (!r) return null;
              const isNow = i === playingReading;
              const isDone = done.has(i);
              const text = sameBook
                ? r.vStart != null
                  ? `${r.chapter}:${r.vStart}-${r.vEnd ?? r.vStart}`
                  : `Ch ${r.chapter}`
                : refRange(r.ho, r.chapter, r.vStart, r.vEnd);
              return (
                <span
                  key={i}
                  className={cn(
                    "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium tabular-nums",
                    isNow
                      ? "bg-primary text-primary-foreground"
                      : isDone
                        ? "bg-success/15 text-success"
                        : "bg-foreground/[0.06] text-muted-foreground",
                  )}
                >
                  {isDone && !isNow && <Check style={{ width: 11, height: 11 }} strokeWidth={3} />}
                  {text}
                </span>
              );
            })}
          </span>
        )}
      </span>
      <span
        className={cn(
          "shrink-0 text-xs font-medium",
          playing ? "text-primary-700 dark:text-primary-300" : status === "done" ? "text-success" : "text-muted-foreground",
        )}
      >
        {onPlay ? STATUS_TEXT[status] : "No audio"}
      </span>
    </button>
  );
}

function StatusDot({ status, n }: { status: RowStatus; n: number }) {
  if (status === "done")
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
        <Check style={{ width: 17, height: 17 }} strokeWidth={3} />
      </span>
    );
  if (status === "playing")
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/30">
        <EqBars />
      </span>
    );
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums",
        status === "next"
          ? "border-primary/50 text-primary-700 dark:text-primary-300"
          : "border-border text-muted-foreground",
      )}
    >
      {n}
    </span>
  );
}

/* ======================== continuous Bible: up next ========================= */

const UP_NEXT = 12;

function UpNextList({ queue, index }: { queue: Track[]; index: number }) {
  const upcoming = queue.slice(index + 1, index + 1 + UP_NEXT);
  const more = queue.length - (index + 1 + upcoming.length);
  const current = queue[index];
  return (
    <div className="px-4 py-5 md:px-6 md:py-7">
      <h3 className="px-1 font-serif text-lg font-bold">Up next</h3>
      <p className="px-1 text-xs text-muted-foreground">
        {queue.length - index - 1 > 0
          ? `${queue.length - index - 1} more chapter${queue.length - index - 1 === 1 ? "" : "s"} queued`
          : "This is the last chapter"}
      </p>
      <ol className="mt-4 space-y-1">
        {current && (
          <li>
            <div
              data-current
              className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <EqBars />
              </span>
              <span className="min-w-0 flex-1 truncate font-serif text-[15px] font-bold text-primary-800 dark:text-primary-200">
                {current.title}
              </span>
              <span className="text-xs font-medium text-primary-700 dark:text-primary-300">Playing</span>
            </div>
          </li>
        )}
        {upcoming.map((t, k) => {
          const i = index + 1 + k;
          return (
            <li key={`${t.ho}-${t.chapter}-${i}`}>
              <button
                onClick={() => jumpTo(i)}
                aria-label={`Play ${t.title}`}
                className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold tabular-nums text-muted-foreground">
                  {k + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-serif text-[15px] font-semibold">{t.title}</span>
                {k === 0 && <span className="text-xs text-muted-foreground">Up next</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {more > 0 && (
        <p className="mt-3 px-1 text-xs text-muted-foreground">
          …and {more} more, through to Revelation.
        </p>
      )}
    </div>
  );
}

/* ================================== hooks =================================== */

/**
 * Keep the playing row in view as playback moves through the list. On desktop the list
 * scrolls in its own column. On a phone the list shares one scroller with the player,
 * so only follow along once the listener has scrolled down to the list — otherwise a
 * track change would push the artwork and controls up under the header.
 */
function useScrollCurrentIntoView(key: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[data-current]");
    if (!el) return;
    const scroller = el.closest<HTMLElement>("[data-np-scroll]");
    if (isPhoneWidth() && (!scroller || scroller.scrollTop === 0)) return;
    el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [key]);
  return ref;
}

/**
 * Swipe-down-to-close for the full-screen sheet (phone or unfolded fold). Drag from the top bar or the cover; let go
 * past ~a fifth of the screen (or with a quick flick) and the sheet closes, otherwise
 * it springs back. Off from `lg` up, where the player is a centred panel.
 */
function useSwipeDown(onClose: () => void) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; t: number; id: number } | null>(null);
  const dy = useRef(0);

  const setOffset = (px: number, animate: boolean) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = animate && !prefersReducedMotion() ? "transform 220ms cubic-bezier(0.32,0.72,0,1)" : "none";
    el.style.transform = px ? `translateY(${px}px)` : "";
  };

  const handleProps = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (!isSheetLayout() || (e.target as HTMLElement).closest("button")) return;
      start.current = { y: e.clientY, t: performance.now(), id: e.pointerId };
      dy.current = 0;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!start.current || e.pointerId !== start.current.id) return;
      dy.current = Math.max(0, e.clientY - start.current.y);
      setOffset(dy.current, false);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const s = start.current;
      if (!s || e.pointerId !== s.id) return;
      start.current = null;
      const velocity = dy.current / Math.max(1, performance.now() - s.t); // px/ms
      if (dy.current > window.innerHeight * 0.2 || (dy.current > 40 && velocity > 0.6)) {
        setOffset(window.innerHeight, true);
        window.setTimeout(onClose, prefersReducedMotion() ? 0 : 200);
      } else {
        setOffset(0, true);
      }
    },
    onPointerCancel: () => {
      start.current = null;
      setOffset(0, true);
    },
  };

  return { sheetRef, handleProps };
}

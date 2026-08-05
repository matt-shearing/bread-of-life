import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, useBlocker, type Location } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Headphones,
  Pause,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from "lucide-react";
import { db } from "@/db";
import { setChapterDone, startPlan } from "@/db/repos";
import { getAnyPlan, type Plan } from "@/data/plans";
import { refRange } from "@/lib/osis";
import { useUI } from "@/store/ui";
import { isDesktopMouse } from "@/lib/device";
import { useAudio, playQueue, pause } from "@/audio/controller";
import { buildReadingQueue } from "@/audio/queue";
import { Reader } from "@/components/bible/Reader";
import { StudyRail } from "@/components/bible/StudyRail";
import { TranslationPicker } from "@/components/bible/TranslationPicker";
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";

/** First reading index in the day not yet ticked off (or the count when done). */
function firstIncomplete(total: number, done: Set<number>): number {
  for (let i = 0; i < total; i++) if (!done.has(i)) return i;
  return total;
}

export function GuidedReaderPage() {
  const params = useParams();
  const planId = params.planId ?? "";
  const day = Number(params.day ?? 0);
  const [searchParams] = useSearchParams();
  // ?reading=<index> lands directly on a specific reading (e.g. tapping "Genesis 1"
  // in the dashboard plan bubble) rather than resuming at the first unread one.
  const requestedReading = searchParams.has("reading") ? Number(searchParams.get("reading")) : null;
  const navigate = useNavigate();
  const { goTo, goToPortion, translation, railOpen, toggleRail, setRailOpen } = useUI();
  const { queue, index: audioIndex, playing } = useAudio();

  const [plan, setPlan] = useState<Plan | null | undefined>(undefined); // undefined = loading
  const [cursor, setCursor] = useState(0);
  const [initialised, setInitialised] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  // Is the audio player working through THIS day's readings (rather than, say, the
  // continuous whole-Bible queue the Bible page starts)? Everything below that reacts
  // to playback is gated on this — a global `playing` made the Listen button claim to
  // be playing this plan whenever anything at all was.
  const audioTrack = queue[audioIndex];
  const dayTrack =
    audioTrack && audioTrack.planId === planId && audioTrack.planDay === day ? audioTrack : null;
  const listening = !!dayTrack && playing;

  // Live per-day chapter progress so ticks persist and resume across visits.
  const progress = useLiveQuery(() => db.plans.get(planId), [planId]);

  /**
   * Readings ticked in this session, held in React alongside Dexie. The live query is
   * the durable record but reports back asynchronously, and while narration is running
   * it is writing to the same row. Deriving the next reading from the live query alone
   * meant a tap could compute its next chapter from a stale set, land on the reading
   * already showing, and look completely dead. Merging the optimistic set makes the
   * button answer immediately; Dexie still owns what survives the session.
   */
  const [ticked, setTicked] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    setTicked(new Set()); // a different plan/day is a different set of readings
  }, [planId, day]);

  const completedSet = useMemo(() => {
    const s = new Set(progress?.chapterProgress?.[day] ?? []);
    for (const i of ticked) s.add(i);
    return s;
  }, [progress, day, ticked]);

  const readings = plan?.days[day] ?? [];
  const total = readings.length;
  const current = readings[cursor];
  const dayComplete = total > 0 && completedSet.size >= total;

  // Resolve the plan (built-in or custom) and make sure it's marked started.
  useEffect(() => {
    let alive = true;
    getAnyPlan(planId).then((p) => {
      if (!alive) return;
      setPlan(p ?? null);
      if (p) startPlan(planId);
    });
    return () => {
      alive = false;
    };
  }, [planId]);

  // Surface the study rail by default only on a real desktop (wide + mouse), as on
  // the Bible page. On touch tablets/folds it would crowd the reader, so leave it closed.
  useEffect(() => {
    if (isDesktopMouse()) setRailOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the plan + its saved progress are in, position the cursor: an explicit
  // ?reading= wins (a tapped reference), otherwise resume at the first unread one.
  useEffect(() => {
    if (initialised || !plan || progress === undefined || total === 0) return;
    let start: number;
    if (requestedReading !== null && Number.isInteger(requestedReading) && requestedReading >= 0 && requestedReading < total) {
      start = requestedReading;
    } else {
      const done = new Set(progress?.chapterProgress?.[day] ?? []);
      start = Math.min(firstIncomplete(total, done), total - 1);
    }
    setCursor(start);
    setInitialised(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, progress, total, day, initialised, requestedReading]);

  // Drive the reused Reader by pointing the shared Bible location at the cursor.
  // Verse-portion readings (Soul Food Classic) scope the reader to their range.
  useEffect(() => {
    if (current) {
      if (current.vStart != null) {
        goToPortion(current.ho, current.chapter, current.vStart, current.vEnd ?? current.vStart);
      } else {
        goTo(current.ho, current.chapter);
      }
    }
    setAtEnd(false);
  }, [current, goTo, goToPortion]);

  // "Reaching a chapter's end can also prompt it": watch the Reader's scroll
  // container and flag when the reader nears the bottom of the passage.
  useEffect(() => {
    if (dayComplete) return;
    let el: HTMLElement | null = null;
    const check = () => {
      if (!el) return;
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
      // Only prompt once there's something to scroll past.
      if (nearBottom && el.scrollHeight > el.clientHeight + 24) setAtEnd(true);
    };
    // The container is (re)created after each chapter loads; poll briefly to bind.
    const attach = window.setInterval(() => {
      const found = document.getElementById("reader-scroll");
      if (found && found !== el) {
        el?.removeEventListener("scroll", check);
        el = found;
        el.addEventListener("scroll", check, { passive: true });
        check();
      }
    }, 300);
    return () => {
      window.clearInterval(attach);
      el?.removeEventListener("scroll", check);
    };
  }, [cursor, dayComplete]);

  // Leave-guard: if they're partway through today's reading, confirm before
  // navigating away. Progress is already saved either way.
  const partway = !dayComplete && completedSet.size > 0;
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: Location; nextLocation: Location }) =>
        partway && currentLocation.pathname !== nextLocation.pathname,
      [partway],
    ),
  );

  // A router only tracks one blocker, and one left sitting in "blocked" swallows every
  // later navigation — the app looks frozen until it is restarted. Always hand the
  // pending navigation back on the way out.
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  useEffect(
    () => () => {
      if (blockerRef.current?.state === "blocked") blockerRef.current.reset?.();
    },
    [],
  );

  /**
   * Follow the narration. The player walks the day's readings on its own (on Android
   * the native queue does it in the background), but the page used to sit wherever the
   * cursor was left — so you could listen through three chapters, stop, and still be
   * looking at the first one, with nothing on screen having moved. Only reacts when the
   * audio index actually CHANGES, so tapping a dot mid-listen isn't yanked back.
   */
  const followedIndex = useRef<number | null>(null);
  useEffect(() => {
    const i = dayTrack?.planReadingIndex ?? null;
    if (i === null || i === followedIndex.current) return;
    followedIndex.current = i;
    if (i >= 0 && i < total) setCursor(i);
  }, [dayTrack, total]);

  // Listen to the whole day: queue every reading's narration and play straight through,
  // starting at the current reading. As each chapter's audio FINISHES it's marked read.
  async function listenToDay(narratorPref?: string) {
    // Only pause when it is THIS day playing. If something else holds the player,
    // tapping Listen should start today's readings, not stop the other thing.
    if (listening) {
      pause();
      return;
    }
    const q = await buildReadingQueue(translation, readings, narratorPref);
    if (!q.length) return;
    // Stamp the day onto every track so the page can recognise its own queue later.
    const dayQueue = q.map((t) => ({ ...t, planId, planDay: day }));
    const found = dayQueue.findIndex((t) => (t.planReadingIndex ?? 0) >= cursor);
    followedIndex.current = null; // re-follow from wherever the queue starts
    playQueue(dayQueue, {
      startIndex: found === -1 ? 0 : found,
      onComplete: (t) => {
        if (t.planReadingIndex != null) {
          setTicked((prev) => new Set(prev).add(t.planReadingIndex!));
          void setChapterDone(planId, day, t.planReadingIndex, true, total).catch(() => {});
        }
      },
    });
  }

  function markReadAndNext() {
    if (!current) return;
    void setChapterDone(planId, day, cursor, true, total);
    setTicked((prev) => new Set(prev).add(cursor));
    const nextDone = new Set(completedSet);
    nextDone.add(cursor);
    const next = firstIncomplete(total, nextDone);
    if (next < total) setCursor(next);
    // If next === total the day is now complete; the completion card renders.
  }

  function stepChapter(delta: number) {
    const n = cursor + delta;
    if (n >= 0 && n < total) setCursor(n);
  }

  if (plan === undefined) return <div className="p-10 text-muted-foreground">Loading plan…</div>;
  if (plan === null || total === 0)
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="text-muted-foreground">This reading plan or day could not be found.</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate("/plans")}>
          Back to plans
        </Button>
      </div>
    );

  const currentDone = completedSet.has(cursor);

  return (
    <div className="flex h-full flex-col">
      {/* Guided header — replaces the chapter picker with day progress. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background/80 px-3 py-2.5 backdrop-blur md:px-4 md:py-3">
        <Tooltip label="Leave guided reading">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Leave guided reading">
            <ArrowLeft style={{ width: 18, height: 18 }} />
          </Button>
        </Tooltip>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{plan.name}</div>
          <div className="text-xs text-muted-foreground">
            Day {day + 1} · Reading {Math.min(cursor + 1, total)} of {total} today
          </div>
        </div>

        {/* Per-chapter dots — jump between the day's readings. */}
        <div className="flex items-center gap-1.5">
          {readings.map((r, i) => {
            const done = completedSet.has(i);
            return (
              <Tooltip key={i} label={refRange(r.ho, r.chapter, r.vStart, r.vEnd)}>
                <button
                  onClick={() => setCursor(i)}
                  aria-label={`Go to ${refRange(r.ho, r.chapter, r.vStart, r.vEnd)}`}
                  className={cn(
                    "flex h-6 min-w-6 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold transition-colors",
                    done
                      ? "border-success bg-success text-success-foreground"
                      : i === cursor
                        ? "border-primary bg-primary/10 text-primary-700 dark:text-primary-300"
                        : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {done ? <Check style={{ width: 13, height: 13 }} /> : i + 1}
                </button>
              </Tooltip>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip label={listening ? "Pause listening" : "Listen to today’s readings"}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void listenToDay()}
              aria-label={listening ? "Pause today's readings" : "Listen to today's readings"}
            >
              {listening ? <Pause style={{ width: 18, height: 18 }} /> : <Headphones style={{ width: 18, height: 18 }} />}
            </Button>
          </Tooltip>
          <Tooltip label="Previous chapter">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => stepChapter(-1)}
              disabled={cursor === 0}
              aria-label="Previous chapter"
            >
              <ChevronLeft style={{ width: 18, height: 18 }} />
            </Button>
          </Tooltip>
          <Tooltip label="Next chapter">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => stepChapter(1)}
              disabled={cursor >= total - 1}
              aria-label="Next chapter"
            >
              <ChevronRight style={{ width: 18, height: 18 }} />
            </Button>
          </Tooltip>
          <TranslationPicker />
          <Tooltip label={railOpen ? "Hide study panel" : "Show study panel"}>
            <Button variant="ghost" size="icon" onClick={toggleRail} aria-label="Toggle study panel">
              {railOpen ? (
                <PanelRightClose style={{ width: 18, height: 18 }} />
              ) : (
                <PanelRightOpen style={{ width: 18, height: 18 }} />
              )}
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <Reader
            swipeToChapter={false}
            scopeToPortion
            // The reader's own headphones button plays TODAY'S readings, not the
            // continuous whole-Bible queue — that one dropped the plan's mark-read.
            onListen={(label) => void listenToDay(label)}
          />
        </div>
        {railOpen && <StudyRail />}

        {/* Footer action bar — advance through the day's readings. */}
        {!dayComplete && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-4 md:pr-[376px]">
            {atEnd && !currentDone && (
              <div className="pointer-events-auto rounded-full border border-primary/30 bg-card/95 px-4 py-1.5 text-xs font-medium text-primary-700 shadow-card backdrop-blur dark:text-primary-300">
                You've reached the end of {current ? refRange(current.ho, current.chapter, current.vStart, current.vEnd) : "this reading"} — mark it read?
              </div>
            )}
            <Button
              size="lg"
              variant={currentDone ? "secondary" : "primary"}
              className={cn("pointer-events-auto shadow-card", atEnd && !currentDone && "animate-pulse")}
              onClick={markReadAndNext}
            >
              {currentDone ? (
                <>
                  <ArrowRight style={{ width: 17, height: 17 }} /> Next chapter
                </>
              ) : (
                <>
                  <Check style={{ width: 17, height: 17 }} /> Mark read &amp; next
                </>
              )}
            </Button>
          </div>
        )}

        {dayComplete && <DayCompleteCard planName={plan.name} day={day} onLeave={() => navigate("/plans")} />}
      </div>

      {/* Leave-guard confirm. */}
      <Dialog open={blocker.state === "blocked"} onOpenChange={(o) => !o && blocker.reset?.()}>
        <DialogContent>
          <DialogTitle>Leave today's reading?</DialogTitle>
          <DialogDescription>
            You're partway through today's reading. Your progress is saved — you can pick up right where you left
            off.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              Keep reading
            </Button>
            <Button variant="outline" onClick={() => blocker.proceed?.()}>
              Leave anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DayCompleteCard({
  planName,
  day,
  onLeave,
}: {
  planName: string;
  day: number;
  onLeave: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm">
      <Card className="max-w-md p-8 text-center shadow-card">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
          <CheckCircle2 style={{ width: 30, height: 30 }} className="text-success" />
        </div>
        <h2 className="font-serif text-2xl font-bold">Day {day + 1} complete</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You've read all of today's portion of <span className="font-medium text-foreground">{planName}</span>. Well
          done — a faithful day in the Word. See you tomorrow.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Sparkles style={{ width: 15, height: 15 }} className="text-primary-500" />
          <Button onClick={onLeave}>Back to plan</Button>
        </div>
      </Card>
    </div>
  );
}

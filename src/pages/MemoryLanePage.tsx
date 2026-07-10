import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Brain, Check, Eye, Flame, PenLine, Sparkles, Trash2 } from "lucide-react";
import { db, type MemoryCard } from "@/db";
import { addMemoryVerse, gradeReview, isMemorised, removeMemoryVerse, type Grade } from "@/db/repos";
import { getChapterFor } from "@/data/bible";
import { MEMORY_STARTERS } from "@/data/memoryStarters";
import { useUI } from "@/store/ui";
import { Button, Card, CardContent } from "@/components/ui";
import { cn } from "@/lib/cn";

const GRADES: { grade: Grade; label: string; hint: string; className: string }[] = [
  { grade: "again", label: "Again", hint: "blanked out", className: "border-rose-300 text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40" },
  { grade: "hard", label: "Hard", hint: "a struggle", className: "border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40" },
  { grade: "good", label: "Good", hint: "got it", className: "border-sky-300 text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40" },
  { grade: "easy", label: "Easy", hint: "effortless", className: "border-green-300 text-green-700 hover:bg-green-50 dark:text-green-300 dark:hover:bg-green-950/40" },
];

/** Blank out ~1 in 3 of the longer words for a fill-in-the-blank test card. */
function blankVerse(text: string): { display: string; blanks: number } {
  const tokens = text.split(/(\s+)/); // keep whitespace tokens
  const wordIdx = tokens
    .map((t, i) => ({ t, i }))
    .filter((x) => /[A-Za-z]/.test(x.t) && x.t.replace(/[^A-Za-z]/g, "").length >= 4);
  if (!wordIdx.length) return { display: text, blanks: 0 };
  // Deterministic-ish spread: blank every 3rd eligible word (at least one).
  const chosen = new Set<number>();
  for (let k = 0; k < wordIdx.length; k += 3) chosen.add(wordIdx[k].i);
  const out = tokens.map((tok, i) => {
    if (!chosen.has(i)) return tok;
    const lead = tok.match(/^[^A-Za-z]*/)?.[0] ?? "";
    const trail = tok.match(/[^A-Za-z]*$/)?.[0] ?? "";
    const core = tok.slice(lead.length, tok.length - trail.length);
    return `${lead}${"_".repeat(Math.max(3, core.length))}${trail}`;
  });
  return { display: out.join(""), blanks: chosen.size };
}

export function MemoryLanePage() {
  const navigate = useNavigate();
  const { memoryStreak, recordMemoryReview } = useUI();
  const cards = useLiveQuery(() => db.memory.orderBy("dueAt").toArray(), [], undefined);

  // Session state — a local queue snapshotted when a review starts, so grading
  // (which reschedules dueAt) doesn't reshuffle the deck mid-session.
  const [queue, setQueue] = useState<MemoryCard[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [done, setDone] = useState(false);
  const [addingStarters, setAddingStarters] = useState(false);

  const now = Date.now();
  const due = useMemo(() => (cards ?? []).filter((c) => c.dueAt <= now), [cards, now]);

  function startReview() {
    if (!due.length) return;
    const shuffled = [...due].sort(() => Math.random() - 0.5);
    setQueue(shuffled);
    setSessionTotal(shuffled.length);
    setReviewedCount(0);
    setRevealed(false);
    setDone(false);
  }

  async function grade(g: Grade) {
    if (!queue || !queue.length) return;
    const [current, ...rest] = queue;
    await gradeReview(current.id, g);
    setReviewedCount((c) => c + 1);
    setRevealed(false);
    if (g === "again") {
      // Relearn this session: send it to the back of the queue.
      setQueue([...rest, current]);
    } else if (rest.length) {
      setQueue(rest);
    } else {
      // Deck cleared.
      setQueue([]);
      setDone(true);
      recordMemoryReview();
    }
  }

  async function addStarters() {
    setAddingStarters(true);
    try {
      for (const s of MEMORY_STARTERS) {
        const ch = await getChapterFor("BSB", s.ho, s.chapter);
        const item = ch?.items.find((it) => it.t === "v" && it.n === s.verse);
        if (item && item.t === "v") {
          await addMemoryVerse({ ho: s.ho, chapter: s.chapter, verse: s.verse, text: item.text, source: "starter" });
        }
      }
    } finally {
      setAddingStarters(false);
    }
  }

  // ------------------------------- render -------------------------------

  if (cards === undefined) {
    return <div className="p-10 text-muted-foreground">Loading…</div>;
  }

  // Active review session.
  if (queue && (queue.length || done)) {
    const current = queue[0];
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-10">
          <div className="mb-6 flex items-center justify-between">
            <button
              onClick={() => {
                setQueue(null);
                setDone(false);
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Memory Lane
            </button>
            <StreakBadge streak={memoryStreak} />
          </div>

          {/* progress */}
          <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${sessionTotal ? (reviewedCount / (reviewedCount + queue.length)) * 100 : 100}%` }}
            />
          </div>

          {done || !current ? (
            <SessionDone streak={memoryStreak} reviewed={reviewedCount} onBack={() => setQueue(null)} />
          ) : (
            <ReviewCard
              card={current}
              // A test card every 3rd review (deterministic within the session).
              test={reviewedCount % 3 === 2}
              revealed={revealed}
              onReveal={() => setRevealed(true)}
              onGrade={grade}
            />
          )}
        </div>
      </div>
    );
  }

  // Pool / overview.
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-serif text-3xl font-bold">
              <Brain style={{ width: 26, height: 26 }} className="text-primary-600" />
              Memory Lane
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Hide His word in your heart — a short daily review deck.
            </p>
          </div>
          <StreakBadge streak={memoryStreak} />
        </div>

        {cards.length === 0 ? (
          <Card className="p-8 text-center">
            <Brain style={{ width: 40, height: 40 }} className="mx-auto mb-3 text-primary-400" />
            <h2 className="font-serif text-xl font-semibold">Your memory pool is empty</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Add verses as you read — tap a verse and choose <span className="font-medium">Memorise</span> — or
              start with a handful of classics.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button onClick={addStarters} disabled={addingStarters}>
                <Sparkles style={{ width: 16, height: 16 }} />
                {addingStarters ? "Adding…" : "Add starter verses"}
              </Button>
              <Button variant="outline" onClick={() => navigate("/bible")}>
                Open the Bible
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <Card className="mb-6">
              <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:justify-between">
                <div>
                  <div className="text-2xl font-bold">
                    {due.length > 0 ? (
                      <>
                        {due.length} verse{due.length === 1 ? "" : "s"} due today
                      </>
                    ) : (
                      "All caught up 🎉"
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {cards.length} verse{cards.length === 1 ? "" : "s"} in your pool
                  </div>
                </div>
                <Button size="lg" onClick={startReview} disabled={!due.length}>
                  {due.length ? "Start review" : "Come back later"}
                </Button>
              </CardContent>
            </Card>

            <div className="space-y-2">
              {cards.map((c) => (
                <PoolRow key={c.id} card={c} onOpen={() => { useUI.getState().goTo(c.ho, c.chapter); navigate("/bible"); }} />
              ))}
            </div>

            <div className="mt-6 text-center">
              <Button variant="outline" size="sm" onClick={addStarters} disabled={addingStarters}>
                <Sparkles style={{ width: 15, height: 15 }} />
                {addingStarters ? "Adding…" : "Add starter verses"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StreakBadge({ streak }: { streak: number }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold",
        streak > 0
          ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-300"
          : "border-border text-muted-foreground",
      )}
    >
      <Flame style={{ width: 16, height: 16 }} className={streak > 0 ? "text-amber-500" : ""} />
      {streak} day{streak === 1 ? "" : "s"}
    </div>
  );
}

function ReviewCard({
  card,
  test,
  revealed,
  onReveal,
  onGrade,
}: {
  card: MemoryCard;
  test: boolean;
  revealed: boolean;
  onReveal: () => void;
  onGrade: (g: Grade) => void;
}) {
  const blanked = useMemo(() => (test ? blankVerse(card.text) : null), [test, card.text]);
  const isTest = !!blanked && blanked.blanks > 0;

  return (
    <Card className="p-8">
      <div className="mb-4 flex items-center justify-center gap-2 text-center">
        <span className="font-serif text-xl font-bold text-primary-700 dark:text-primary-300">{card.reference}</span>
        {isTest && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary-700 dark:text-primary-300">
            <PenLine style={{ width: 12, height: 12 }} />
            fill the blanks
          </span>
        )}
      </div>

      {!revealed ? (
        <div className="text-center">
          {isTest ? (
            <p className="mx-auto max-w-lg whitespace-pre-wrap font-serif text-lg leading-loose text-foreground/90">
              {blanked!.display}
            </p>
          ) : (
            <p className="text-muted-foreground">Recall the verse from memory, then reveal it.</p>
          )}
          <Button className="mt-6" onClick={onReveal}>
            <Eye style={{ width: 16, height: 16 }} />
            Reveal verse
          </Button>
        </div>
      ) : (
        <>
          <p className="mx-auto max-w-lg text-center font-serif text-lg leading-loose">{card.text}</p>
          <p className="mt-6 text-center text-sm text-muted-foreground">How well did you recall it?</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GRADES.map((g) => (
              <button
                key={g.grade}
                onClick={() => onGrade(g.grade)}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg border bg-background px-3 py-2.5 transition-colors",
                  g.className,
                )}
              >
                <span className="text-sm font-semibold">{g.label}</span>
                <span className="text-[11px] opacity-70">{g.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function SessionDone({ streak, reviewed, onBack }: { streak: number; reviewed: number; onBack: () => void }) {
  return (
    <Card className="p-10 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Check style={{ width: 32, height: 32 }} className="text-primary-600" />
      </div>
      <h2 className="font-serif text-2xl font-bold">Well done!</h2>
      <p className="mt-2 text-muted-foreground">
        You reviewed {reviewed} verse{reviewed === 1 ? "" : "s"} today.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2 text-amber-600 dark:text-amber-400">
        <Flame style={{ width: 18, height: 18 }} />
        <span className="font-semibold">{streak}-day streak</span>
      </div>
      <Button className="mt-6" onClick={onBack}>
        Back to Memory Lane
      </Button>
    </Card>
  );
}

function PoolRow({ card, onOpen }: { card: MemoryCard; onOpen: () => void }) {
  const mastered = isMemorised(card);
  const dueLabel =
    card.dueAt <= Date.now()
      ? "due now"
      : `due ${new Date(card.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="font-medium">{card.reference}</span>
          {mastered && (
            <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-300">
              memorised
            </span>
          )}
        </div>
        <div className="truncate text-sm text-muted-foreground">{card.text}</div>
      </button>
      <span className="shrink-0 text-xs text-muted-foreground">{dueLabel}</span>
      <button
        onClick={() => removeMemoryVerse(card.id)}
        aria-label="Remove from Memory Lane"
        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
      >
        <Trash2 style={{ width: 16, height: 16 }} />
      </button>
    </div>
  );
}

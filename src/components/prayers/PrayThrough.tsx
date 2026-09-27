/**
 * Pray-through mode: a calm, full-screen session that walks one prayer at a time
 * (Prayed / Answered… / Skip) and ends with a short summary.
 *
 *  - `scope="due"`  → today's reminder prayers not yet prayed today (`isDueToday`).
 *  - `scope="all"`  → every active prayer, least recently prayed first.
 *
 * The queue is fixed when the session opens, so praying for one prayer (which
 * changes `lastPrayedAt`) never reshuffles what comes next.
 *
 * `PrayThroughButton` is the small self-contained entry point (it owns the session
 * state), for the Prayers page and — later — the dashboard.
 */
import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, HandHeart, Sparkles, X } from "lucide-react";
import { db, type Prayer } from "@/db";
import { isDueToday, markAnswered, prayedFor } from "@/db/repos";
import { parseOsis, refLabel } from "@/lib/osis";
import { Button, Textarea } from "@/components/ui";
import { useBackGuard } from "@/components/confirm";
import { cn } from "@/lib/cn";

export type PrayThroughScope = "due" | "all";
type Outcome = "prayed" | "answered" | "skipped";

/** Prayers for a session, in the order they will be shown. */
export function prayThroughQueue(prayers: Prayer[], scope: PrayThroughScope): Prayer[] {
  const pool = prayers.filter((p) => (scope === "due" ? isDueToday(p) : p.status === "active"));
  return pool.sort(
    (a, b) => (a.lastPrayedAt ?? 0) - (b.lastPrayedAt ?? 0) || a.createdAt - b.createdAt,
  );
}

/** Live counts for the entry points: due today, and all active. */
export function usePrayThroughCounts(): { due: number; active: number } | undefined {
  return useLiveQuery(async () => {
    const active = await db.prayers.where("status").equals("active").toArray();
    return { due: active.filter((p) => isDueToday(p)).length, active: active.length };
  }, []);
}

function catLabel(c: string) {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function osisLabel(osis: string) {
  const p = parseOsis(osis);
  return p ? refLabel(p.ho, p.chapter, p.verse) : osis;
}

/* --------------------------------- entry point -------------------------------- */

/**
 * A button that opens a pray-through session. Shows today's due count when there
 * is one; otherwise offers to pray through every active prayer. Renders nothing
 * when there are no active prayers.
 */
export function PrayThroughButton({
  className,
  variant = "banner",
}: {
  className?: string;
  /** "banner" is a full-width card row; "button" is a compact button. */
  variant?: "banner" | "button";
}) {
  const counts = usePrayThroughCounts();
  const [session, setSession] = useState<PrayThroughScope | null>(null);
  if (!counts || counts.active === 0) return null;
  const scope: PrayThroughScope = counts.due > 0 ? "due" : "all";
  const n = scope === "due" ? counts.due : counts.active;

  const label =
    scope === "due"
      ? `${n} prayer${n === 1 ? "" : "s"} for today`
      : `Pray through your ${n} active prayer${n === 1 ? "" : "s"}`;

  return (
    <>
      {variant === "banner" ? (
        <button
          type="button"
          data-testid="pray-through-start"
          onClick={() => setSession(scope)}
          className={cn(
            "flex min-h-[52px] w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
            scope === "due"
              ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
              : "border-border bg-card hover:bg-accent",
            className,
          )}
        >
          <HandHeart size={20} className="shrink-0 text-primary-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{label}</span>
            <span className="block text-xs text-muted-foreground">
              One at a time, without distraction.
            </span>
          </span>
          <span className="shrink-0 whitespace-nowrap text-sm font-medium text-primary-700 dark:text-primary-300">
            Pray through →
          </span>
        </button>
      ) : (
        <Button
          variant="outline"
          data-testid="pray-through-start"
          className={cn("whitespace-nowrap", className)}
          onClick={() => setSession(scope)}
        >
          <HandHeart size={16} /> Pray through{scope === "due" ? ` (${n})` : ""}
        </Button>
      )}
      {session && <PrayerSession scope={session} onClose={() => setSession(null)} />}
    </>
  );
}

/* ----------------------------------- session ---------------------------------- */

export function PrayerSession({ scope, onClose }: { scope: PrayThroughScope; onClose: () => void }) {
  const [queue, setQueue] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [answering, setAnswering] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);

  // Fix the queue once, at the start.
  useEffect(() => {
    let live = true;
    void db.prayers.toArray().then((all) => {
      if (live) setQueue(prayThroughQueue(all, scope).map((p) => p.id));
    });
    return () => {
      live = false;
    };
  }, [scope]);

  const currentId = queue && !ended ? queue[index] : undefined;
  const current = useLiveQuery(() => (currentId ? db.prayers.get(currentId) : undefined), [currentId]);
  const done = queue !== null && (ended || index >= queue.length);
  const acted = Object.keys(outcomes).length > 0;

  function advance(outcome: Outcome) {
    if (!currentId) return;
    setOutcomes((o) => ({ ...o, [currentId]: outcome }));
    setAnswering(false);
    setNote("");
    setIndex((i) => i + 1);
  }

  async function onPrayed() {
    if (!currentId || busy) return;
    setBusy(true);
    try {
      await prayedFor(currentId);
      advance("prayed");
    } finally {
      setBusy(false);
    }
  }

  async function onAnswered() {
    if (!currentId || busy) return;
    setBusy(true);
    try {
      await markAnswered(currentId, note);
      advance("answered");
    } finally {
      setBusy(false);
    }
  }

  /** Escape, the close button and Android back all land here. */
  function requestEnd(): boolean {
    if (answering) {
      setAnswering(false);
      return true;
    }
    if (!done && acted) {
      setEnded(true); // show what was prayed before leaving
      return true;
    }
    onClose();
    return false;
  }
  useBackGuard(true, requestEnd);

  const total = queue?.length ?? 0;
  const summary = useMemo(() => {
    const vals = Object.values(outcomes);
    return {
      prayed: vals.filter((v) => v === "prayed").length,
      answered: vals.filter((v) => v === "answered").length,
      skipped: vals.filter((v) => v === "skipped").length,
      left: Math.max(0, total - vals.length),
    };
  }, [outcomes, total]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && requestEnd()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          data-testid="pray-through"
          aria-describedby={undefined}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="fixed inset-0 z-[55] flex flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] animate-fade-in"
        >
          {/* a soft dawn wash behind the top of the screen */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary-100/70 to-transparent dark:from-primary-900/30"
          />
          {/* top bar */}
          <div className="relative flex items-center gap-3 px-4 py-3">
            <DialogPrimitive.Close
              aria-label={done ? "Close" : "End session"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={20} />
            </DialogPrimitive.Close>
            <DialogPrimitive.Title className="text-sm font-medium text-muted-foreground">
              {scope === "due" ? "Today's prayers" : "Pray through"}
            </DialogPrimitive.Title>
            {!done && total > 0 && (
              <span className="ml-auto text-sm tabular-nums text-muted-foreground" data-testid="pray-through-progress">
                {Math.min(index + 1, total)} of {total}
              </span>
            )}
          </div>
          {!done && total > 0 && (
            <div className="relative mx-4 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${(index / total) * 100}%` }}
              />
            </div>
          )}

          <div className="relative flex flex-1 items-center justify-center overflow-y-auto px-5 py-6">
            <div className="w-full max-w-xl">
              {queue === null ? null : done || total === 0 ? (
                <Summary total={total} summary={summary} onClose={onClose} />
              ) : current ? (
                <div key={current.id} className="animate-fade-in">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary-700 dark:text-primary-300">
                    {catLabel(current.category)}
                  </div>
                  <h2 className="text-2xl font-semibold leading-snug sm:text-3xl" data-testid="pray-through-title">
                    {current.title}
                  </h2>
                  {current.body && (
                    <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-muted-foreground">
                      {current.body}
                    </p>
                  )}
                  {current.linkedOsis.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {current.linkedOsis.map((o) => (
                        <span
                          key={o}
                          className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs text-primary-700 dark:text-primary-300"
                        >
                          {osisLabel(o)}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-4 text-xs text-muted-foreground">
                    {current.prayedCount === 0
                      ? "First time praying this here."
                      : `Prayed ${current.prayedCount} ${current.prayedCount === 1 ? "time" : "times"} before`}
                    {current.lastPrayedAt ? ` · last on ${new Date(current.lastPrayedAt).toLocaleDateString()}` : ""}
                  </p>

                  {answering ? (
                    <div className="mt-8 space-y-3">
                      <label htmlFor="pt-answer" className="block text-sm font-medium">
                        How did God answer?
                      </label>
                      <Textarea
                        id="pt-answer"
                        autoFocus
                        rows={4}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Write it down so you can remember what He has done."
                      />
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="ghost" className="h-12" onClick={() => setAnswering(false)}>
                          Back
                        </Button>
                        <Button variant="success" className="h-12" disabled={busy} onClick={() => void onAnswered()}>
                          <CheckCircle2 size={18} /> Mark answered
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-10 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                      <Button className="h-14 text-base" disabled={busy} onClick={() => void onPrayed()}>
                        <HandHeart size={18} /> Prayed
                      </Button>
                      <Button
                        variant="outline"
                        className="h-14 border-success/40 text-success hover:bg-success/10"
                        onClick={() => setAnswering(true)}
                      >
                        <CheckCircle2 size={18} /> Answered…
                      </Button>
                      <Button variant="ghost" className="h-14" onClick={() => advance("skipped")}>
                        Skip
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Summary({
  total,
  summary,
  onClose,
}: {
  total: number;
  summary: { prayed: number; answered: number; skipped: number; left: number };
  onClose: () => void;
}) {
  if (total === 0) {
    return (
      <div className="text-center" data-testid="pray-through-summary">
        <HandHeart size={36} className="mx-auto text-primary-500" />
        <p className="mt-4 text-lg font-semibold">Nothing is waiting today</p>
        <p className="mt-2 text-sm text-muted-foreground">You have prayed for everything on today's list.</p>
        <Button className="mt-8 h-12 px-8" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }
  const parts: string[] = [];
  if (summary.prayed) parts.push(`You prayed for ${summary.prayed} ${summary.prayed === 1 ? "request" : "requests"}.`);
  if (summary.answered)
    parts.push(`${summary.answered} ${summary.answered === 1 ? "prayer was" : "prayers were"} marked answered — praise God.`);
  if (summary.skipped) parts.push(`${summary.skipped} skipped for now.`);
  if (summary.left) parts.push(`${summary.left} left for later.`);
  return (
    <div className="text-center" data-testid="pray-through-summary">
      <Sparkles size={36} className="mx-auto text-primary-500" />
      <p className="mt-4 text-xl font-semibold">Amen.</p>
      <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-muted-foreground">
        {parts.length ? parts.join(" ") : "You ended before praying for any of these. They'll be here when you're ready."}
      </p>
      <blockquote className="mx-auto mt-8 max-w-md font-serif text-base italic leading-relaxed text-foreground/80">
        “Be anxious for nothing, but in everything, by prayer and petition, with thanksgiving, present your
        requests to God. And the peace of God, which surpasses all understanding, will guard your hearts and your
        minds in Christ Jesus.”
        <footer className="mt-2 font-sans text-xs not-italic text-muted-foreground">Philippians 4:6–7</footer>
      </blockquote>
      <Button className="mt-8 h-12 px-8" onClick={onClose} data-testid="pray-through-done">
        Done
      </Button>
    </div>
  );
}

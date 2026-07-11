import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Printer, Sparkles } from "lucide-react";
import { db, type Prayer } from "@/db";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

const CAT_LABEL: Record<string, string> = {
  personal: "Personal",
  family: "Family",
  community: "Community",
  thanksgiving: "Thanksgiving",
  world: "World",
};
function catLabel(c: string): string {
  return CAT_LABEL[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
}

function longDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}
function monthYear(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * A printable "Record of His Faithfulness" — the answered-prayer log laid out as a
 * keepsake the user can save as a PDF (via the browser / OS print-to-PDF) and look
 * back on. Rendered on a STANDALONE route (outside the app shell) so it prints clean.
 */
export function FaithfulnessPage() {
  const navigate = useNavigate();
  // Chronological — a journey to look back over. `undefined` while loading.
  const prayers = useLiveQuery(
    () => db.prayers.where("status").equals("answered").toArray(),
    [],
    undefined,
  );

  if (prayers === undefined) {
    return <div className="p-10 text-center text-muted-foreground">Gathering His faithfulness…</div>;
  }

  const answered = [...prayers].sort((a, b) => (a.answeredAt ?? 0) - (b.answeredAt ?? 0));

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      {/* Action bar — hidden when printing. */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/90 px-4 py-3 backdrop-blur print:hidden">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft style={{ width: 18, height: 18 }} />
        </Button>
        <div className="text-sm font-semibold">Faithfulness review</div>
        <Button className="ml-auto" size="sm" onClick={() => window.print()} disabled={answered.length === 0}>
          <Printer style={{ width: 15, height: 15 }} /> Save as PDF
        </Button>
      </div>

      {answered.length === 0 ? (
        <div className="mx-auto max-w-md p-10 text-center">
          <p className="text-muted-foreground">
            When you mark a prayer answered — with a note on <em>how</em> God answered — it becomes part of
            your record here, ready to look back on and give thanks.
          </p>
          <Button className="mt-4" variant="outline" onClick={() => navigate("/prayers")}>
            Back to prayers
          </Button>
        </div>
      ) : (
        <article className="mx-auto max-w-2xl px-6 py-10 print:py-0">
          {/* Cover */}
          <header className="mb-10 text-center">
            <div className="mb-3 flex items-center justify-center gap-1.5 text-primary-600">
              <Sparkles style={{ width: 16, height: 16 }} />
              <span className="text-xs font-semibold uppercase tracking-wider">Bread of Life</span>
            </div>
            <h1 className="font-serif text-4xl font-bold leading-tight">A Record of His Faithfulness</h1>
            <p className="mx-auto mt-5 max-w-lg font-serif text-lg italic leading-relaxed text-muted-foreground">
              “Because of the loving devotion of the LORD we are not consumed, for His mercies never fail.
              They are new every morning; great is Your faithfulness!”
            </p>
            <p className="mt-2 text-sm text-muted-foreground">Lamentations 3:22–23</p>
            <div className="mx-auto mt-6 h-px w-24 bg-border" />
            <p className="mt-6 text-sm text-muted-foreground">
              {answered.length} answered prayer{answered.length === 1 ? "" : "s"}
              {answered[0].answeredAt && (
                <> · {monthYear(answered[0].answeredAt)} – {monthYear(answered[answered.length - 1].answeredAt ?? Date.now())}</>
              )}
            </p>
          </header>

          {/* Entries */}
          <div className="space-y-8">
            {answered.map((p) => (
              <FaithEntry key={p.id} p={p} />
            ))}
          </div>

          <footer className="mt-12 border-t border-border pt-6 text-center">
            <p className="font-serif italic text-muted-foreground">
              “Give thanks to the LORD, for He is good; His loving devotion endures forever.”
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Psalm 107:1</p>
          </footer>
        </article>
      )}
    </div>
  );
}

function FaithEntry({ p }: { p: Prayer }) {
  return (
    <section className={cn("break-inside-avoid rounded-xl border border-border p-5", "print:border-black/10")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {p.answeredAt && (
          <span className="text-xs font-semibold uppercase tracking-wide text-success">{longDate(p.answeredAt)}</span>
        )}
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          {catLabel(p.category)}
        </span>
        {p.prayedCount > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            prayed {p.prayedCount} time{p.prayedCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <h2 className="mt-2 font-serif text-xl font-bold">{p.title}</h2>
      {p.body?.trim() && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">You prayed: </span>
          {p.body}
        </p>
      )}
      {p.answerNote?.trim() && (
        <div className="mt-3 rounded-lg bg-success/5 p-3 print:bg-transparent print:p-0">
          <p className="text-sm leading-relaxed">
            <span className="font-semibold text-success">How God answered: </span>
            {p.answerNote}
          </p>
        </div>
      )}
    </section>
  );
}

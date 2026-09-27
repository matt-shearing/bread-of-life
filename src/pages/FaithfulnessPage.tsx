import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, BookOpen, Copy, NotebookPen, Printer, Share2, Sparkles } from "lucide-react";
import { db, type JournalEntry, type Prayer } from "@/db";
import { Button } from "@/components/ui";
import { htmlToText } from "@/lib/htmlToText";
import { entryTitle } from "@/components/journal/entryTitle";
import { showUndoToast } from "@/components/confirm";
import { parseOsis, refLabel } from "@/lib/osis";
import { cn } from "@/lib/cn";
import { AnsweredByMonth } from "@/components/prayers/AnsweredByMonth";

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
function monthName(m: number): string {
  return new Date(2000, m, 1).toLocaleDateString(undefined, { month: "long" });
}
function osisLabel(osis: string): string {
  const p = parseOsis(osis);
  return p ? refLabel(p.ho, p.chapter, p.verse) : osis;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
// Android's WebView very likely ignores window.print(), so the phone leads with
// Share / Copy instead (still offering Print in case the device supports it).
const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

/** Plain-text (Markdown) version of the record, for sharing or pasting into notes. */
export function faithfulnessMarkdown(
  prayers: Prayer[],
  journal: Map<string, JournalEntry>,
  rangeLabel: string,
): string {
  const out: string[] = ["# A Record of His Faithfulness", ""];
  if (rangeLabel) out.push(`_${rangeLabel}_`, "");
  for (const p of prayers) {
    out.push(`## ${p.title}`);
    const meta = [p.answeredAt ? `Answered ${longDate(p.answeredAt)}` : null, catLabel(p.category)];
    if (p.prayedCount > 0) meta.push(`prayed ${p.prayedCount} time${p.prayedCount === 1 ? "" : "s"}`);
    out.push(meta.filter(Boolean).join(" · "), "");
    if (p.body?.trim()) out.push(`**You prayed:** ${p.body.trim()}`, "");
    if (p.answerNote?.trim()) out.push(`**How God answered:** ${p.answerNote.trim()}`, "");
    if (p.linkedOsis.length) out.push(`**Verses:** ${p.linkedOsis.map(osisLabel).join("; ")}`, "");
    const entries = (p.linkedJournalIds ?? []).map((id) => journal.get(id)).filter(Boolean) as JournalEntry[];
    if (entries.length) {
      out.push("**Journal:**");
      for (const j of entries) out.push(`- ${entryTitle(j)} (${longDate(j.createdAt)})`);
      out.push("");
    }
  }
  out.push("> Give thanks to the LORD, for He is good; His loving devotion endures forever. — Psalm 107:1", "");
  return out.join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older WebViews: fall back to a hidden textarea.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * A printable "Record of His Faithfulness" — the answered-prayer log laid out as a
 * keepsake the user can save as a PDF (via the browser / OS print-to-PDF) and look
 * back on. Rendered on a STANDALONE route (outside the app shell) so it prints clean.
 * A year / month filter narrows the record; each prayer shows the verses and
 * journal entries linked to it.
 */
export function FaithfulnessPage() {
  const navigate = useNavigate();
  const [year, setYear] = useState<number | "all">("all");
  const [month, setMonth] = useState<number | "all">("all");
  // Chronological — a journey to look back over. `undefined` while loading.
  const prayers = useLiveQuery(
    () => db.prayers.where("status").equals("answered").toArray(),
    [],
    undefined,
  );
  const journalIds = useMemo(
    () => [...new Set((prayers ?? []).flatMap((p) => p.linkedJournalIds ?? []))].sort(),
    [prayers],
  );
  const journal = useLiveQuery(
    async () => {
      if (!journalIds.length) return new Map<string, JournalEntry>();
      const rows = await db.journal.where("id").anyOf(journalIds).toArray();
      return new Map(rows.map((j) => [j.id, j]));
    },
    [journalIds.join(",")],
    new Map<string, JournalEntry>(),
  );

  const all = useMemo(
    () => [...(prayers ?? [])].sort((a, b) => (a.answeredAt ?? 0) - (b.answeredAt ?? 0)),
    [prayers],
  );
  const years = useMemo(
    () =>
      [...new Set(all.filter((p) => p.answeredAt).map((p) => new Date(p.answeredAt!).getFullYear()))].sort(
        (a, b) => b - a,
      ),
    [all],
  );
  const months = useMemo(
    () =>
      year === "all"
        ? []
        : [
            ...new Set(
              all
                .filter((p) => p.answeredAt && new Date(p.answeredAt).getFullYear() === year)
                .map((p) => new Date(p.answeredAt!).getMonth()),
            ),
          ].sort((a, b) => a - b),
    [all, year],
  );

  if (prayers === undefined) {
    return <div className="p-10 text-center text-muted-foreground">Gathering His faithfulness…</div>;
  }

  const answered = all.filter((p) => {
    if (year === "all") return true;
    if (!p.answeredAt) return false;
    const d = new Date(p.answeredAt);
    return d.getFullYear() === year && (month === "all" || d.getMonth() === month);
  });
  const rangeLabel =
    year === "all" ? "" : month === "all" ? String(year) : `${monthName(month)} ${year}`;

  const text = () => faithfulnessMarkdown(answered, journal ?? new Map(), rangeLabel);
  const onShare = async () => {
    try {
      await navigator.share({ title: "A Record of His Faithfulness", text: text() });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") void onCopy();
    }
  };
  const onCopy = async () => {
    const ok = await copyText(text());
    showUndoToast({
      message: ok
        ? "Copied — paste it into a note, a message or an email."
        : "Couldn't copy on this device.",
    });
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      {/* Action bar — hidden when printing. */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 py-3 backdrop-blur print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft size={18} />
          </Button>
          <div className="min-w-0 truncate text-sm font-semibold">Faithfulness review</div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {isAndroid && canShare && (
              <Button size="sm" onClick={() => void onShare()} disabled={answered.length === 0}>
                <Share2 size={15} /> Share
              </Button>
            )}
            <Button
              size="sm"
              variant={isAndroid && !canShare ? "primary" : "outline"}
              onClick={() => void onCopy()}
              disabled={answered.length === 0}
              aria-label="Copy the record as text"
            >
              <Copy size={15} />
              <span className={cn(!isAndroid && "hidden sm:inline")}>Copy text</span>
            </Button>
            <Button
              size="sm"
              variant={isAndroid ? "ghost" : "primary"}
              onClick={() => window.print()}
              disabled={answered.length === 0}
              aria-label={isAndroid ? "Print" : undefined}
            >
              <Printer size={15} />
              {isAndroid ? null : isTauri ? "Save as PDF" : "Print / PDF"}
            </Button>
          </div>
        </div>
        {years.length > 0 && (
          <div className="mx-auto mt-2 flex max-w-2xl flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Year</span>
              <select
                value={year}
                onChange={(e) => {
                  setYear(e.target.value === "all" ? "all" : Number(e.target.value));
                  setMonth("all");
                }}
                className="h-9 rounded-md border border-input bg-background px-2 [@media(pointer:coarse)]:h-11"
              >
                <option value="all">All years</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Month</span>
              <select
                value={month}
                disabled={year === "all"}
                onChange={(e) => setMonth(e.target.value === "all" ? "all" : Number(e.target.value))}
                className="h-9 rounded-md border border-input bg-background px-2 disabled:opacity-50 [@media(pointer:coarse)]:h-11"
              >
                <option value="all">All months</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {all.length === 0 ? (
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
              <Sparkles size={16} />
              <span className="text-xs font-semibold uppercase tracking-wider">Bread of Life</span>
            </div>
            <h1 className="font-serif text-4xl font-bold leading-tight">A Record of His Faithfulness</h1>
            <p className="mx-auto mt-5 max-w-lg font-serif text-lg italic leading-relaxed text-muted-foreground">
              “Because of the loving devotion of the LORD we are not consumed, for His mercies never fail.
              They are new every morning; great is Your faithfulness!”
            </p>
            <p className="mt-2 text-sm text-muted-foreground">Lamentations 3:22–23</p>
            <div className="mx-auto mt-6 h-px w-24 bg-border" />
            <p className="mt-6 text-sm text-muted-foreground" data-testid="faith-count">
              {answered.length} answered prayer{answered.length === 1 ? "" : "s"}
              {rangeLabel ? (
                <> · {rangeLabel}</>
              ) : (
                answered[0]?.answeredAt && (
                  <>
                    {" "}
                    · {monthYear(answered[0].answeredAt)} –{" "}
                    {monthYear(answered[answered.length - 1].answeredAt ?? Date.now())}
                  </>
                )
              )}
            </p>
            <AnsweredByMonth prayers={all} year={year === "all" ? new Date().getFullYear() : year} />
          </header>

          {/* Entries */}
          {answered.length === 0 ? (
            <p className="text-center text-muted-foreground">No prayers were marked answered in {rangeLabel}.</p>
          ) : (
            <div className="space-y-8">
              {answered.map((p) => (
                <FaithEntry key={p.id} p={p} journal={journal ?? new Map()} />
              ))}
            </div>
          )}

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

function FaithEntry({ p, journal }: { p: Prayer; journal: Map<string, JournalEntry> }) {
  const entries = (p.linkedJournalIds ?? []).map((id) => journal.get(id)).filter(Boolean) as JournalEntry[];
  return (
    <section
      className={cn("break-inside-avoid rounded-xl border border-border p-5", "print:border-black/10")}
      data-testid="faith-entry"
    >
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
      {p.linkedOsis.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <BookOpen size={13} className="shrink-0 text-primary-600" />
          {p.linkedOsis.map(osisLabel).join(" · ")}
        </p>
      )}
      {entries.length > 0 && (
        <div className="mt-3 space-y-2 border-l-2 border-primary/30 pl-3">
          {entries.map((j) => {
            const snippet = htmlToText(j.body);
            return (
              <div key={j.id} className="text-sm">
                <div className="flex items-center gap-1.5 font-medium">
                  <NotebookPen size={13} className="shrink-0 text-primary-600" />
                  {entryTitle(j)}
                  <span className="text-xs font-normal text-muted-foreground">· {longDate(j.createdAt)}</span>
                </div>
                {snippet && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {snippet.length > 220 ? `${snippet.slice(0, 217).trimEnd()}…` : snippet}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

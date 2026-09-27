import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, BookOpen, Clock, HandHeart, NotebookPen, Search as SearchIcon, StickyNote, X } from "lucide-react";
import { db } from "@/db";
import { searchBible, translationById, type SearchHit } from "@/data/bible";
import { BOOKS, parseOsis, refLabel } from "@/lib/osis";
import { formatReference, parseReference } from "@/lib/reference";
import { htmlToText } from "@/lib/htmlToText";
import { useUI } from "@/store/ui";
import { useOpenRef } from "@/lib/useOpenRef";
import { Card, Input, PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Snippet({ text, terms }: { text: string; terms: string[] }) {
  const nodes = useMemo(() => {
    if (!terms.length) return [text];
    const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "ig");
    const termSet = new Set(terms.map((t) => t.toLowerCase()));
    return text.split(re).map((part, i) =>
      termSet.has(part.toLowerCase()) ? (
        <mark key={i} className="rounded bg-primary/30 px-0.5 text-foreground">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  }, [text, terms]);
  return <>{nodes}</>;
}

/** A short window of `text` around the first matched term, so long entries stay readable. */
function around(text: string, terms: string[], width = 160): string {
  const lower = text.toLowerCase();
  const at = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0), Infinity);
  if (!Number.isFinite(at) || text.length <= width) return text.slice(0, width) + (text.length > width ? "…" : "");
  const start = Math.max(0, at - 50);
  return (start > 0 ? "…" : "") + text.slice(start, start + width) + (start + width < text.length ? "…" : "");
}

type Scope = "all" | "OT" | "NT" | string; // or a book id

function scopeBooks(scope: Scope): Set<string> | undefined {
  if (scope === "all") return undefined;
  if (scope === "OT" || scope === "NT") return new Set(BOOKS.filter((b) => b.testament === scope).map((b) => b.ho));
  return new Set([scope]);
}

interface MineHit {
  key: string;
  kind: "journal" | "prayer" | "note";
  title: string;
  text: string;
  open: () => void;
}

const EXAMPLES = ["jn 3:16", "Ps 23", "1 Cor 13:4-7", "love one another", "do not be anxious"];

export function SearchPage() {
  const navigate = useNavigate();
  const openRef = useOpenRef();
  const [params, setParams] = useSearchParams();
  const { translation, recentSearches, addRecentSearch, clearRecentSearches } = useUI();
  // The query lives in the URL, so "Back to search" from the reader returns to these results.
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [scope, setScope] = useState<Scope>(() => params.get("in") ?? "all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (scope !== "all") next.set("in", scope);
    // Only when it changed: an identical replace is still a navigation, which hands us
    // a new setParams and would loop.
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [query, scope, params, setParams]);

  const q = query.trim();
  const ref = useMemo(() => parseReference(q), [q]);
  // "Romans" on its own is both a book and a search word: offer the book, keep the words.
  const onlyRef = !!ref && !ref.bookOnly;

  useEffect(() => {
    if (q.length < 2 || onlyRef) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let alive = true;
    const id = setTimeout(() => {
      searchBible(q, 200, { books: scopeBooks(scope) }).then((r) => {
        if (!alive) return;
        setHits(r);
        setSearching(false);
      });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, scope, onlyRef]);

  const terms = useMemo(() => q.toLowerCase().split(/\s+/).filter(Boolean), [q]);
  const here = { path: `/search?${new URLSearchParams({ q, ...(scope !== "all" ? { in: scope } : {}) })}`, label: "search" };

  // Your own writing: journal, prayers and verse notes (read-only; everything is local).
  const journal = useLiveQuery(() => db.journal.toArray(), [], []);
  const prayers = useLiveQuery(() => db.prayers.toArray(), [], []);
  const notes = useLiveQuery(() => db.notes.toArray(), [], []);
  const mine = useMemo((): MineHit[] => {
    if (q.length < 2 || onlyRef) return [];
    const match = (s: string) => {
      const t = s.toLowerCase();
      return terms.every((term) => t.includes(term));
    };
    const out: MineHit[] = [];
    for (const j of journal ?? []) {
      const body = htmlToText(j.body);
      if (match(`${j.title} ${body} ${j.tags.join(" ")}`))
        out.push({
          key: `j:${j.id}`,
          kind: "journal",
          title: j.title || new Date(j.createdAt).toLocaleDateString(),
          text: around(body, terms),
          open: () => navigate(`/journal?open=${j.id}`),
        });
    }
    for (const p of prayers ?? []) {
      if (match(`${p.title} ${p.body} ${p.answerNote ?? ""}`))
        out.push({
          key: `p:${p.id}`,
          kind: "prayer",
          title: p.title,
          text: around([p.body, p.answerNote].filter(Boolean).join(" · "), terms),
          open: () => navigate(`/prayers?focus=${p.id}`),
        });
    }
    for (const n of notes ?? []) {
      const at = parseOsis(n.osis);
      if (!at || !match(n.body)) continue;
      out.push({
        key: `n:${n.id}`,
        kind: "note",
        title: `Note on ${refLabel(at.ho, at.chapter, at.verse)}`,
        text: around(n.body, terms),
        open: () => openRef(at.ho, at.chapter, at.verse, here),
      });
    }
    return out;
    // `here` is derived from q/scope, already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, onlyRef, terms, journal, prayers, notes]);

  function goRef() {
    if (!ref) return;
    addRecentSearch(q);
    openRef(ref.ho, ref.chapter, ref.verse, here);
  }

  function open(hit: SearchHit) {
    addRecentSearch(q);
    openRef(hit.ho, hit.chapter, hit.verse, here);
  }

  const searchedName = translationById("BSB")?.name ?? "Berean Standard Bible";
  const reading = translationById(translation);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <PageHeader
          className="mb-5"
          title="Search"
          subtitle={<>
          Type a reference to go straight there, or words to search the {searchedName} (BSB) and your own journal,
          prayers and notes.
          {translation !== "BSB" && reading && (
            <> Verses are matched in the BSB and open in your reading translation, {reading.short}.</>
          )}
        </>}
        />

        <form
          role="search"
          className="mb-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (ref) goRef();
            else addRecentSearch(q);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={inputRef}
              id="search-input"
              type="search"
              aria-label="Search the Bible or go to a reference"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="John 3:16, or words like “peace”…"
              className="h-12 pl-10 text-base"
              enterKeyHint="search"
            />
          </div>
          <label className="sr-only" htmlFor="search-scope">
            Search in
          </label>
          <select
            id="search-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-12 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-48"
          >
            <option value="all">Whole Bible</option>
            <option value="OT">Old Testament</option>
            <option value="NT">New Testament</option>
            <optgroup label="Old Testament books">
              {BOOKS.filter((b) => b.testament === "OT").map((b) => (
                <option key={b.ho} value={b.ho}>
                  {b.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="New Testament books">
              {BOOKS.filter((b) => b.testament === "NT").map((b) => (
                <option key={b.ho} value={b.ho}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          </select>
        </form>

        {ref && (
          <button
            onClick={goRef}
            className="mb-5 flex w-full items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 p-4 text-left transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BookOpen size={20} className="shrink-0 text-primary-700 dark:text-primary-300" />
            <span className="min-w-0 flex-1">
              <span className="block font-serif text-lg font-bold">Go to {formatReference(ref)}</span>
              <span className="block text-xs text-muted-foreground">Press Enter to open it in the reader</span>
            </span>
            <ArrowRight size={18} className="shrink-0 text-muted-foreground" />
          </button>
        )}

        {q.length < 2 && (
          <div className="space-y-5">
            {recentSearches.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent</h2>
                  <button
                    onClick={clearRecentSearches}
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentSearches.map((r) => (
                    <button
                      key={r}
                      onClick={() => setQuery(r)}
                      className="flex min-h-10 items-center gap-1.5 rounded-full border border-border px-3 text-sm hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Clock size={13} className="text-muted-foreground" />
                      {r}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Try</h2>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setQuery(r)}
                    className="flex min-h-10 items-center rounded-full border border-dashed border-border px-3 text-sm text-muted-foreground hover:border-primary/40 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {mine.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              In your journal, prayers and notes ({mine.length})
            </h2>
            <div className="space-y-2">
              {mine.slice(0, 12).map((m) => (
                <button
                  key={m.key}
                  onClick={() => {
                    addRecentSearch(q);
                    m.open();
                  }}
                  className="block w-full rounded-lg border border-border bg-card p-3 text-left shadow-card hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {m.kind === "journal" ? (
                      <NotebookPen size={14} className="shrink-0 text-primary-600" />
                    ) : m.kind === "prayer" ? (
                      <HandHeart size={14} className="shrink-0 text-rose-500" />
                    ) : (
                      <StickyNote size={14} className="shrink-0 text-primary-600" />
                    )}
                    <span className="truncate">
                      <Snippet text={m.title} terms={terms} />
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] font-normal capitalize text-muted-foreground">{m.kind}</span>
                  </div>
                  {m.text && (
                    <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
                      <Snippet text={m.text} terms={terms} />
                    </p>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {q.length >= 2 && !onlyRef && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                In the Bible (BSB){scope !== "all" && ` · ${scope === "OT" ? "Old Testament" : scope === "NT" ? "New Testament" : BOOKS.find((b) => b.ho === scope)?.name}`}
              </h2>
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {searching ? "Searching…" : `${hits.length}${hits.length >= 200 ? "+" : ""} verse${hits.length === 1 ? "" : "s"}`}
              </span>
              {scope !== "all" && (
                <button
                  onClick={() => setScope("all")}
                  className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                >
                  <X size={12} /> Whole Bible
                </button>
              )}
            </div>
            <div className="space-y-2">
              {hits.map((h) => (
                <button
                  key={h.bbcccvvv}
                  onClick={() => open(h)}
                  className="block w-full rounded-lg border border-border bg-card p-4 text-left shadow-card hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="mb-1 text-xs font-semibold text-primary-700 dark:text-primary-300">
                    {refLabel(h.ho, h.chapter, h.verse)}
                  </div>
                  <p className="font-serif text-[15px] leading-relaxed">
                    <Snippet text={h.text} terms={terms} />
                  </p>
                </button>
              ))}
            </div>
            {!searching && hits.length === 0 && (
              <Card className={cn("p-8 text-center text-muted-foreground", mine.length > 0 && "mt-2")}>
                No verses found for “{q}”{scope !== "all" && " here — try the whole Bible"}.
              </Card>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

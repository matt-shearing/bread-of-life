import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { BookMarked, HandHeart, Languages, Link2, NotebookPen, Notebook, X } from "lucide-react";
import { useUI } from "@/store/ui";
import { db } from "@/db";
import { bookByHo, parseOsis, refLabel } from "@/lib/osis";
import { getChapterFor, verses } from "@/data/bible";
import { htmlToText } from "@/components/journal/RichEditor";
import {
  COMMENTARY_SOURCES,
  fetchCommentaryChapter,
  type CommentaryChapter,
} from "@/data/commentary";
import {
  getCrossRefs,
  getHebrewVerse,
  getStrongsVerse,
  loadHebLexicon,
  loadLexicon,
  type LexEntry,
  type StrongToken,
  type XrefEntry,
} from "@/data/study";
import { cn } from "@/lib/cn";

export function StudyRail() {
  const { railTab, setRailTab, toggleRail } = useUI();
  return (
    <aside className="fixed inset-0 z-40 flex w-full flex-col border-l border-border bg-card pt-[env(safe-area-inset-top)] md:static md:z-auto md:w-[360px] md:shrink-0 md:pt-0">
      <div className="flex items-center border-b border-border px-2">
        <TabButton active={railTab === "commentary"} onClick={() => setRailTab("commentary")} icon={<BookMarked style={{ width: 15, height: 15 }} />}>
          Commentary
        </TabButton>
        <TabButton active={railTab === "xref"} onClick={() => setRailTab("xref")} icon={<Link2 style={{ width: 15, height: 15 }} />}>
          Cross-refs
        </TabButton>
        <TabButton active={railTab === "strongs"} onClick={() => setRailTab("strongs")} icon={<Languages style={{ width: 15, height: 15 }} />}>
          Strong's
        </TabButton>
        <TabButton active={railTab === "references"} onClick={() => setRailTab("references")} icon={<Notebook style={{ width: 15, height: 15 }} />}>
          References
        </TabButton>
        <button
          onClick={toggleRail}
          aria-label="Close study panel"
          className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent md:hidden"
        >
          <X style={{ width: 18, height: 18 }} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {railTab === "commentary" && <CommentaryPanel />}
        {railTab === "xref" && <XrefPanel />}
        {railTab === "strongs" && <StrongsPanel />}
        {railTab === "references" && <ReferencesPanel />}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* -------------------------------- Commentary -------------------------------- */

function CommentaryPanel() {
  const { ho, chapter, commentarySource, setCommentarySource } = useUI();
  const [data, setData] = useState<CommentaryChapter | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "empty">("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    setData(null);
    fetchCommentaryChapter(commentarySource, ho, chapter).then((res) => {
      if (!alive) return;
      if (res && res.blocks.length) {
        setData(res);
        setState("ok");
      } else setState("empty");
    });
    return () => {
      alive = false;
    };
  }, [ho, chapter, commentarySource]);

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        {COMMENTARY_SOURCES.map((s) => (
          <button
            key={s.id}
            onClick={() => setCommentarySource(s.id)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs transition-colors",
              commentarySource === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
            )}
            title={s.name}
          >
            {s.short}
          </button>
        ))}
      </div>
      <div className="px-4 py-3 text-sm leading-relaxed">
        {state === "loading" && <p className="text-muted-foreground">Loading commentary…</p>}
        {state === "empty" && (
          <p className="text-muted-foreground">
            No commentary here for this chapter (or offline and not cached). Try another source above.
          </p>
        )}
        {state === "ok" && data && (
          <div className="space-y-4">
            {data.intro && (
              <p className="border-l-2 border-primary/40 pl-3 text-[13px] italic text-muted-foreground">
                {data.intro.length > 320 ? data.intro.slice(0, 320) + "…" : data.intro}
              </p>
            )}
            {data.blocks.map((b) => (
              <div key={b.verse}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary-600">Verse {b.verse}</div>
                {b.paragraphs.map((p, i) => (
                  <p key={i} className="mb-2 text-[13.5px] text-foreground/90">
                    {p}
                  </p>
                ))}
              </div>
            ))}
            <p className="pt-2 text-center text-[11px] text-muted-foreground">
              {COMMENTARY_SOURCES.find((s) => s.id === commentarySource)?.name} · Public Domain
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Cross-references ------------------------------ */

function osisLabel(osis: string): string {
  const [start] = osis.split("-");
  const p = parseOsis(start);
  const base = p ? refLabel(p.ho, p.chapter, p.verse) : osis;
  return osis.includes("-") ? `${base} ff.` : base;
}

function XrefPanel() {
  const { ho, chapter, selectedVerse, goTo } = useUI();
  const verse = selectedVerse ?? 1;
  const [refs, setRefs] = useState<XrefEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getCrossRefs(ho, chapter, verse).then((r) => {
      if (!alive) return;
      setRefs(r);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [ho, chapter, verse]);

  return (
    <div className="px-4 py-3">
      <div className="mb-3 text-sm">
        Cross-references for <span className="font-semibold">{refLabel(ho, chapter, verse)}</span>
        {selectedVerse == null && <span className="ml-1 text-xs text-muted-foreground">(click a verse to change)</span>}
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : refs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cross-references for this verse.</p>
      ) : (
        <div className="space-y-1.5">
          {refs.map((x, i) => (
            <XrefRow key={i} osis={x.r} onOpen={(hoT, chT) => goTo(hoT, chT)} />
          ))}
          <p className="pt-2 text-center text-[11px] text-muted-foreground">
            OpenBible.info cross-references · CC-BY
          </p>
        </div>
      )}
    </div>
  );
}

function XrefRow({ osis, onOpen }: { osis: string; onOpen: (ho: string, chapter: number) => void }) {
  const [text, setText] = useState<string>("");
  const start = osis.split("-")[0];
  const p = parseOsis(start);

  useEffect(() => {
    if (!p) return;
    let alive = true;
    getChapterFor("BSB", p.ho, p.chapter).then((ch) => {
      if (!alive || !ch || p.verse == null) return;
      const v = verses(ch).find((x) => x.n === p.verse);
      if (v) setText(v.text);
    });
    return () => {
      alive = false;
    };
  }, [osis]);

  if (!p) return null;
  return (
    <button
      onClick={() => onOpen(p.ho, p.chapter)}
      className="block w-full rounded-md border border-border p-2.5 text-left hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="text-xs font-semibold text-primary-600">{osisLabel(osis)}</div>
      {text && <div className="mt-0.5 line-clamp-2 font-serif text-[13px] text-foreground/90">{text}</div>}
    </button>
  );
}

/* -------------------------------- References -------------------------------- */

/** Journal entries and prayers whose linkedOsis fall in the current chapter. If a
 *  verse is selected, exact-verse matches float to the top. Tappable → the entry. */
function ReferencesPanel() {
  const { ho, chapter, selectedVerse } = useUI();
  const navigate = useNavigate();
  const journal = useLiveQuery(() => db.journal.toArray(), [], []);
  const prayers = useLiveQuery(() => db.prayers.toArray(), [], []);

  const refs = useMemo(() => {
    type Ref = {
      key: string;
      kind: "journal" | "prayer";
      id: string;
      title: string;
      snippet: string;
      osis: string[];
      exact: boolean;
    };
    const inChapter = (osis: string) => {
      const p = parseOsis(osis);
      return p != null && p.ho === ho && p.chapter === chapter;
    };
    const out: Ref[] = [];
    for (const j of journal ?? []) {
      const hits = j.linkedOsis.filter(inChapter);
      if (!hits.length) continue;
      out.push({
        key: `j:${j.id}`,
        kind: "journal",
        id: j.id,
        title: j.title,
        snippet: htmlToText(j.body).slice(0, 140),
        osis: hits,
        exact: selectedVerse != null && hits.some((o) => parseOsis(o)?.verse === selectedVerse),
      });
    }
    for (const p of prayers ?? []) {
      const hits = p.linkedOsis.filter(inChapter);
      if (!hits.length) continue;
      out.push({
        key: `p:${p.id}`,
        kind: "prayer",
        id: p.id,
        title: p.title,
        snippet: p.body.slice(0, 140),
        osis: hits,
        exact: selectedVerse != null && hits.some((o) => parseOsis(o)?.verse === selectedVerse),
      });
    }
    return out.sort((a, b) => Number(b.exact) - Number(a.exact));
  }, [journal, prayers, ho, chapter, selectedVerse]);

  return (
    <div className="px-4 py-3">
      <div className="mb-3 text-sm">
        Your references in <span className="font-semibold">{refLabel(ho, chapter)}</span>
      </div>
      {refs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No journal entries or prayers link to this chapter yet. Tag a verse from the journal editor,
          or use the “J” / pray actions on a verse.
        </p>
      ) : (
        <div className="space-y-1.5">
          {refs.map((r) => (
            <button
              key={r.key}
              onClick={() =>
                navigate(r.kind === "journal" ? `/journal?open=${r.id}` : `/prayers?focus=${r.id}`)
              }
              className={cn(
                "block w-full rounded-md border p-2.5 text-left hover:bg-accent/40",
                r.exact ? "border-primary/50" : "border-border hover:border-primary/40",
              )}
            >
              <div className="flex items-center gap-1.5">
                {r.kind === "journal" ? (
                  <NotebookPen style={{ width: 13, height: 13 }} className="shrink-0 text-primary-600" />
                ) : (
                  <HandHeart style={{ width: 13, height: 13 }} className="shrink-0 text-rose-500" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {r.osis.map((o) => parseOsis(o)?.verse).filter(Boolean).join(", ") || "ch."}
                </span>
              </div>
              {r.snippet && (
                <div className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{r.snippet}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Strong's --------------------------------- */

function StrongsPanel() {
  const { ho, chapter, selectedVerse } = useUI();
  const verse = selectedVerse ?? 1;
  const [tokens, setTokens] = useState<StrongToken[]>([]);
  const [lex, setLex] = useState<Record<string, LexEntry>>({});
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isOT = (bookByHo(ho)?.order ?? 40) <= 39;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setActive(null);
    const loader = isOT
      ? Promise.all([getHebrewVerse(ho, chapter, verse), loadHebLexicon()])
      : Promise.all([getStrongsVerse(ho, chapter, verse), loadLexicon()]);
    loader.then(([t, l]) => {
      if (!alive) return;
      setTokens(t);
      setLex(l);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [ho, chapter, verse, isOT]);

  const entry = active ? lex[active] : null;

  return (
    <div className="px-4 py-3">
      <div className="mb-2 text-sm">
        Word study · <span className="font-semibold">{refLabel(ho, chapter, verse)}</span>
        {selectedVerse == null && <span className="ml-1 text-xs text-muted-foreground">(click a verse)</span>}
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        {isOT ? "Hebrew — Westminster Leningrad Codex (OSHB)" : "Greek — BSB word tags"}
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">No word-study data for this verse.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1" dir={isOT ? "rtl" : "ltr"}>
            {tokens.map((t, i) => (
              <button
                key={i}
                onClick={() => setActive(t.s)}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-serif transition-colors",
                  isOT ? "text-lg" : "text-sm",
                  active === t.s ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                )}
                title={t.s}
              >
                {t.w}
              </button>
            ))}
          </div>
          {entry && (
            <div className="mt-4 rounded-md border border-border p-3">
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-lg">{entry.lemma}</span>
                {entry.xlit && <span className="text-sm italic text-muted-foreground">{entry.xlit}</span>}
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {active}
                </span>
              </div>
              {entry.gloss && <div className="mt-1 text-sm font-medium">{entry.gloss}</div>}
              {entry.def && <p className="mt-1.5 text-[13px] text-foreground/85">{entry.def}</p>}
            </div>
          )}
          {!entry && <p className="mt-3 text-xs text-muted-foreground">Tap a word to see its Strong's entry.</p>}
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { BookMarked, HandHeart, Languages, Link2, Notebook, NotebookPen, X } from "lucide-react";
import { useUI } from "@/store/ui";
import { db } from "@/db";
import { bookByHo, parseOsis, refLabel } from "@/lib/osis";
import { getChapterFor, verses } from "@/data/bible";
import { htmlToText } from "@/components/journal/RichEditor";
import {
  COMMENTARY_SOURCES,
  MISSLER_ACKNOWLEDGMENT,
  MISSLER_SOURCE,
  fetchCommentaryChapter,
  type CommentaryChapter,
  type CommentarySource,
} from "@/data/commentary";
import { misslerAvailable } from "@/data/missler";
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
import { useRailLayout } from "@/lib/layout";
import { useOpenRef } from "@/lib/useOpenRef";

type RailTab = "commentary" | "xref" | "strongs" | "references";
const RAIL_TABS: { id: RailTab; label: string; icon: typeof BookMarked }[] = [
  { id: "commentary", label: "Commentary", icon: BookMarked },
  { id: "xref", label: "Cross-refs", icon: Link2 },
  { id: "strongs", label: "Strong's", icon: Languages },
  { id: "references", label: "References", icon: Notebook },
];
/** Below this rail width only the active tab keeps its label; the others show an icon. */
const ALL_LABELS_MIN_PX = 460;

/**
 * The study rail. Its size and placement come from `useRailLayout` (src/lib/layout.ts),
 * the one place that knows how much room the rail may take:
 *  - phone: a full-screen sheet with a close button;
 *  - Fold / narrow window: a panel floating over the right of the reader (≤ 40%);
 *  - desktop: docked beside the reader, drag its edge to resize (≤ 40%).
 * The parent must be `relative` and pad its reading column by `reserve`.
 */
export function StudyRail() {
  const { railTab, setRailTab, setRailOpen } = useUI();
  const { mode, width } = useRailLayout();
  const allLabels = width >= ALL_LABELS_MIN_PX;

  // Escape closes the floating panel/sheet (the docked rail stays put on desktop,
  // where Esc also clears a verse range in the reader).
  useEffect(() => {
    if (mode === "docked") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role=dialog][data-state=open], [data-radix-popper-content-wrapper]")) return;
      setRailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, setRailOpen]);

  return (
    <aside
      data-study-rail={mode}
      aria-label="Study panel"
      style={mode === "sheet" ? undefined : { width }}
      className={cn(
        "flex flex-col bg-card",
        mode === "sheet" && "fixed inset-0 z-40 w-full pt-[env(safe-area-inset-top)]",
        mode === "overlay" && "absolute inset-y-0 right-0 z-30 border-l border-border shadow-2xl",
        mode === "docked" && "absolute inset-y-0 right-0 z-20 border-l border-border",
      )}
    >
      {mode === "docked" && <ResizeHandle />}
      <div className="flex items-stretch border-b border-border">
        <div role="tablist" aria-label="Study tools" className="flex min-w-0 flex-1 overflow-x-auto px-1 [scrollbar-width:none]">
          {RAIL_TABS.map((t) => {
            const Icon = t.icon;
            const active = railTab === t.id;
            return (
              <TabButton
                key={t.id}
                active={active}
                showLabel={allLabels || active}
                label={t.label}
                onClick={() => setRailTab(t.id)}
                icon={<Icon style={{ width: 16, height: 16 }} />}
              />
            );
          })}
        </div>
        {/* Close sits OUTSIDE the scrolling tab strip, so it can never be pushed off the edge. */}
        <button
          onClick={() => setRailOpen(false)}
          aria-label="Close study panel"
          title="Close study panel"
          className="flex w-11 shrink-0 items-center justify-center border-l border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <X style={{ width: 18, height: 18 }} />
        </button>
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
        {railTab === "commentary" && <CommentaryPanel />}
        {railTab === "xref" && <XrefPanel />}
        {railTab === "strongs" && <StrongsPanel />}
        {railTab === "references" && <ReferencesPanel />}
      </div>
    </aside>
  );
}

/**
 * Draggable left-edge divider — docked (desktop) only. The rail is the right-most
 * element, so its right edge sits at the viewport edge; the new width is simply
 * the distance from the pointer to that edge. The store clamps to 280–640px and
 * useRailLayout caps what is shown at 40% of the main column.
 */
function ResizeHandle() {
  const setRailWidth = useUI((s) => s.setRailWidth);

  function onPointerDown(e: ReactPointerEvent) {
    e.preventDefault();
    const move = (ev: PointerEvent) => setRailWidth(window.innerWidth - ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={() => setRailWidth(360)}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize study panel"
      className="group absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none"
      title="Drag to resize · double-click to reset"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/60 group-active:bg-primary" />
    </div>
  );
}

function TabButton({
  active,
  showLabel,
  label,
  onClick,
  icon,
}: {
  active: boolean;
  showLabel: boolean;
  label: string;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={showLabel ? undefined : label}
      onClick={onClick}
      className={cn(
        "flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        showLabel ? "flex-auto" : "flex-none",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {showLabel && <span>{label}</span>}
    </button>
  );
}

/* -------------------------------- Commentary -------------------------------- */

/** The public-domain set, plus the local MI library once its folder is set.
 *  The first time the library is detected, MI becomes the selected source —
 *  once only, so a user who later picks another commentary stays respected. */
function useAvailableCommentarySources(): CommentarySource[] {
  const [missler, setMissler] = useState(false);
  const setCommentarySource = useUI((s) => s.setCommentarySource);
  useEffect(() => {
    let alive = true;
    misslerAvailable().then((ok) => {
      if (!alive) return;
      setMissler(ok);
      if (ok && !localStorage.getItem("mi-defaulted")) {
        localStorage.setItem("mi-defaulted", "1");
        setCommentarySource(MISSLER_SOURCE.id);
      }
    });
    return () => {
      alive = false;
    };
  }, [setCommentarySource]);
  return missler ? [...COMMENTARY_SOURCES, MISSLER_SOURCE] : COMMENTARY_SOURCES;
}

function CommentaryPanel() {
  const { ho, chapter, commentarySource, setCommentarySource } = useUI();
  const openXref = useOpenXref();
  const sources = useAvailableCommentarySources();
  const [data, setData] = useState<CommentaryChapter | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "empty">("loading");
  const isMissler = commentarySource === MISSLER_SOURCE.id;

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
        {sources.map((s) => (
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
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary-600">
                  {b.endVerse && b.endVerse !== b.verse ? `Verses ${b.verse}–${b.endVerse}` : `Verse ${b.verse}`}
                </div>
                {b.paragraphs.map((p, i) => (
                  <p key={i} className="mb-2 text-[13.5px] text-foreground/90">
                    {p}
                  </p>
                ))}
                {b.xrefs && b.xrefs.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {b.xrefs.map((x) => (
                      <XrefChip key={x} osis={x} onOpen={openXref} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            <p className="pt-2 text-center text-[11px] text-muted-foreground">
              {isMissler
                ? MISSLER_ACKNOWLEDGMENT
                : `${sources.find((s) => s.id === commentarySource)?.name} · Public Domain`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** A small clickable cross-reference chip (Missler blocks). Ranges like
 *  "Heb.1.1-Heb.1.3" jump to the start ref's chapter, mirroring the Cross-refs tab. */
function XrefChip({ osis, onOpen }: { osis: string; onOpen: XrefOpener }) {
  const p = parseOsis(osis.split("-")[0]);
  if (!p) return null;
  return (
    <button
      onClick={() => onOpen(p.ho, p.chapter, p.verse)}
      className="rounded-full border border-border px-2 py-0.5 text-[11px] text-primary-600 transition-colors hover:border-primary/40 hover:bg-accent"
    >
      {osisLabel(osis)}
    </button>
  );
}

/* ------------------------------ Cross-references ------------------------------ */

type XrefOpener = (ho: string, chapter: number, verse?: number) => void;

/**
 * Following a cross-reference is a peek: land on the verse, and offer "Back to"
 * the verse you came from (or to today's plan reading, from the guided reader).
 */
function useOpenXref(): XrefOpener {
  const openRef = useOpenRef();
  const { pathname, search } = useLocation();
  return (hoT, chT, vT) => {
    const s = useUI.getState();
    const guided = pathname.startsWith("/guided");
    const label = guided ? "today's reading" : refLabel(s.ho, s.chapter, s.selectedVerse ?? undefined);
    openRef(hoT, chT, vT, { path: guided ? pathname + search : "/bible", label });
  };
}

function osisLabel(osis: string): string {
  const [start] = osis.split("-");
  const p = parseOsis(start);
  const base = p ? refLabel(p.ho, p.chapter, p.verse) : osis;
  return osis.includes("-") ? `${base} ff.` : base;
}

function XrefPanel() {
  const { ho, chapter, selectedVerse } = useUI();
  const openXref = useOpenXref();
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
            <XrefRow key={i} osis={x.r} onOpen={openXref} />
          ))}
          <p className="pt-2 text-center text-[11px] text-muted-foreground">
            OpenBible.info cross-references · CC-BY
          </p>
        </div>
      )}
    </div>
  );
}

function XrefRow({ osis, onOpen }: { osis: string; onOpen: XrefOpener }) {
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
      onClick={() => onOpen(p.ho, p.chapter, p.verse)}
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
          or use the Journal / Pray actions on a verse.
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

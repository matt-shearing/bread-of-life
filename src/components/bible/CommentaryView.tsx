import { useEffect, useId, useState } from "react";
import { Link2 } from "lucide-react";
import { useUI } from "@/store/ui";
import {
  COMMENTARY_SOURCES,
  MISSLER_ACKNOWLEDGMENT,
  MISSLER_SOURCE,
  fetchCommentaryChapter,
  type CommentaryChapter,
  type CommentarySource,
} from "@/data/commentary";
import { misslerAvailable } from "@/data/missler";
import { parseOsis, refLabel } from "@/lib/osis";
import { cn } from "@/lib/cn";

/**
 * Commentary, built once and shown in two places: the full-width Commentary page and
 * the Commentary tab of the study rail. Both use the same sources, the same source
 * picker (full names, one select) and the same chapter view; only the density differs.
 */

/** The public-domain set, plus the local MI library once its folder is set.
 *  The first time the library is detected, MI becomes the selected source —
 *  once only, so a user who later picks another commentary stays respected. */
export function useCommentarySources(): CommentarySource[] {
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

/** The one commentary picker: a labelled native select with each source's full name. */
export function CommentarySourceSelect({
  sources,
  label = "Commentary",
  hideLabel,
  className,
}: {
  sources: CommentarySource[];
  label?: string;
  /** Keep the label for screen readers only (it still names the select). */
  hideLabel?: boolean;
  className?: string;
}) {
  const id = useId();
  const commentarySource = useUI((s) => s.commentarySource);
  const setCommentarySource = useUI((s) => s.setCommentarySource);
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <label htmlFor={id} className={cn("shrink-0 text-sm text-muted-foreground", hideLabel && "sr-only")}>
        {label}
      </label>
      <select
        id={id}
        value={commentarySource}
        onChange={(e) => setCommentarySource(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11"
      >
        {/* A synced choice this device can't show (MI without the library) still reads right. */}
        {!sources.some((s) => s.id === commentarySource) && <option value={commentarySource}>{commentarySource}</option>}
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

type OpenRef = (ho: string, chapter: number, verse?: number) => void;

/** One chapter of the chosen commentary. `compact` is the rail's denser setting. */
export function CommentaryView({
  ho,
  chapter,
  sources,
  onOpenRef,
  compact,
}: {
  ho: string;
  chapter: number;
  sources: CommentarySource[];
  onOpenRef: OpenRef;
  compact?: boolean;
}) {
  const commentarySource = useUI((s) => s.commentarySource);
  const [data, setData] = useState<CommentaryChapter | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "empty">("loading");
  const isMissler = commentarySource === MISSLER_SOURCE.id;
  const sourceName = sources.find((s) => s.id === commentarySource)?.name ?? "";

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

  if (state === "loading") return <p className="text-muted-foreground">Loading commentary…</p>;
  if (state === "empty" || !data)
    return (
      <p className="text-muted-foreground">
        No commentary here for this chapter (or you’re offline and it isn’t cached). Try another source.
      </p>
    );

  const intro = compact && data.intro && data.intro.length > 320 ? data.intro.slice(0, 320) + "…" : data.intro;

  return (
    <div className={compact ? "space-y-4" : "space-y-6"}>
      {intro && (
        <p
          className={cn(
            "border-l-2 border-primary/40 italic text-muted-foreground",
            compact ? "pl-3 text-[13px]" : "pl-4 font-serif text-base leading-relaxed",
          )}
        >
          {intro}
        </p>
      )}
      {data.blocks.map((b) => (
        <section key={b.verse} className="scroll-mt-4">
          <div
            className={cn(
              "text-xs font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-400",
              compact ? "mb-1" : "mb-1.5",
            )}
          >
            {b.endVerse && b.endVerse !== b.verse ? `Verses ${b.verse}–${b.endVerse}` : `Verse ${b.verse}`}
          </div>
          {b.paragraphs.map((p, i) => (
            <p key={i} className={cn("text-foreground/90", compact ? "mb-2 text-[13.5px]" : "mb-3 leading-relaxed")}>
              {p}
            </p>
          ))}
          {b.xrefs && b.xrefs.length > 0 && (
            <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "mt-1.5" : "mt-2")}>
              <Link2 size={13} className="text-muted-foreground" aria-hidden />
              {b.xrefs.map((x) => (
                <XrefChip key={x} osis={x} onOpen={onOpenRef} />
              ))}
            </div>
          )}
        </section>
      ))}
      <p className={cn("pt-2 text-center text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
        {isMissler ? MISSLER_ACKNOWLEDGMENT : `${sourceName} · Public Domain`}
      </p>
    </div>
  );
}

/** A clickable cross-reference chip. Ranges like "Heb.1.1-Heb.1.3" open the start. */
function XrefChip({ osis, onOpen }: { osis: string; onOpen: OpenRef }) {
  const p = parseOsis(osis.split("-")[0]);
  if (!p) return null;
  const label = refLabel(p.ho, p.chapter, p.verse) + (osis.includes("-") ? " ff." : "");
  return (
    <button
      onClick={() => onOpen(p.ho, p.chapter, p.verse)}
      className="rounded-full border border-border px-2 py-0.5 text-[11px] text-primary-700 transition-colors hover:border-primary/40 hover:bg-accent dark:text-primary-400 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:text-xs"
    >
      {label}
    </button>
  );
}

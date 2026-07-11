import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Link2 } from "lucide-react";
import { ChapterPicker } from "@/components/bible/ChapterPicker";
import { useUI } from "@/store/ui";
import { useChapterNav } from "@/lib/useChapterNav";
import {
  COMMENTARY_SOURCES,
  MISSLER_SOURCE,
  fetchCommentaryChapter,
  type CommentaryChapter,
  type CommentarySource,
} from "@/data/commentary";
import { misslerAvailable } from "@/data/missler";
import { parseOsis, refLabel } from "@/lib/osis";
import { Button, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * A dedicated, full-width home for the commentaries — the same pluggable sources as
 * the Bible study rail (Matthew Henry, JFB, … and the Missler library when configured),
 * but with room to read. The rail in the Bible reader stays as-is for study-in-context.
 */
export function CommentaryPage() {
  const { ho, chapter, commentarySource, setCommentarySource, goTo } = useUI();
  const { step, canPrev, canNext } = useChapterNav();
  const [sources, setSources] = useState<CommentarySource[]>(COMMENTARY_SOURCES);
  const [data, setData] = useState<CommentaryChapter | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "empty">("loading");
  const isMissler = commentarySource === MISSLER_SOURCE.id;

  useEffect(() => {
    let alive = true;
    misslerAvailable().then((ok) => alive && setSources(ok ? [...COMMENTARY_SOURCES, MISSLER_SOURCE] : COMMENTARY_SOURCES));
    return () => {
      alive = false;
    };
  }, [ho, chapter]);

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
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-background/80 px-3 py-2.5 backdrop-blur md:px-4 md:py-3">
        <ChapterPicker />
        <div className="flex items-center gap-1">
          <Tooltip label="Previous chapter">
            <Button variant="ghost" size="icon" onClick={() => step(-1)} disabled={!canPrev} aria-label="Previous chapter">
              <ChevronLeft style={{ width: 18, height: 18 }} />
            </Button>
          </Tooltip>
          <Tooltip label="Next chapter">
            <Button variant="ghost" size="icon" onClick={() => step(1)} disabled={!canNext} aria-label="Next chapter">
              <ChevronRight style={{ width: 18, height: 18 }} />
            </Button>
          </Tooltip>
        </div>
      </header>

      {/* Source selector — full names, there's room here. */}
      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
        {sources.map((s) => (
          <button
            key={s.id}
            onClick={() => setCommentarySource(s.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              commentarySource === s.id
                ? "border-primary bg-primary/10 text-primary-700 dark:text-primary-300"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 py-6 md:px-8">
          <h1 className="font-serif text-2xl font-bold">
            {refLabel(ho, chapter)}
            <span className="ml-2 align-middle text-sm font-normal text-muted-foreground">
              · {sources.find((s) => s.id === commentarySource)?.name}
            </span>
          </h1>

          {state === "loading" && <p className="mt-6 text-muted-foreground">Loading commentary…</p>}
          {state === "empty" && (
            <p className="mt-6 text-muted-foreground">
              No commentary here for this chapter (or you’re offline and it isn’t cached). Try another source above.
            </p>
          )}
          {state === "ok" && data && (
            <div className="mt-5 space-y-6">
              {data.intro && (
                <p className="border-l-2 border-primary/40 pl-4 font-serif text-base italic leading-relaxed text-muted-foreground">
                  {data.intro}
                </p>
              )}
              {data.blocks.map((b) => (
                <section key={b.verse} className="scroll-mt-4">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-primary-600">
                    {b.endVerse && b.endVerse !== b.verse ? `Verses ${b.verse}–${b.endVerse}` : `Verse ${b.verse}`}
                  </div>
                  {b.paragraphs.map((p, i) => (
                    <p key={i} className="mb-3 leading-relaxed text-foreground/90">
                      {p}
                    </p>
                  ))}
                  {b.xrefs && b.xrefs.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Link2 style={{ width: 13, height: 13 }} className="text-muted-foreground" />
                      {b.xrefs.map((x) => {
                        const p = parseOsis(x.split("-")[0]);
                        if (!p) return null;
                        return (
                          <button
                            key={x}
                            onClick={() => goTo(p.ho, p.chapter)}
                            className="rounded-full border border-border px-2 py-0.5 text-[11px] text-primary-600 transition-colors hover:border-primary/40 hover:bg-accent"
                          >
                            {refLabel(p.ho, p.chapter, p.verse)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
              <p className="pt-2 text-center text-xs text-muted-foreground">
                {isMissler
                  ? "Chuck Missler · Line by Line — personal library, not for redistribution"
                  : `${sources.find((s) => s.id === commentarySource)?.name} · Public Domain`}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { BookMarked } from "lucide-react";
import { useUI } from "@/store/ui";
import { refLabel } from "@/lib/osis";
import {
  COMMENTARY_SOURCES,
  fetchCommentaryChapter,
  type CommentaryChapter,
} from "@/data/commentary";
import { cn } from "@/lib/cn";

export function CommentaryRail() {
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
      } else {
        setState("empty");
      }
    });
    return () => {
      alive = false;
    };
  }, [ho, chapter, commentarySource]);

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <BookMarked style={{ width: 16, height: 16 }} className="text-primary-600" />
        <span className="text-sm font-semibold">Commentary</span>
        <span className="ml-auto text-xs text-muted-foreground">{refLabel(ho, chapter)}</span>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        {COMMENTARY_SOURCES.map((s) => (
          <button
            key={s.id}
            onClick={() => setCommentarySource(s.id)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs transition-colors",
              commentarySource === s.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
            title={s.name}
          >
            {s.short}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed">
        {state === "loading" && <p className="text-muted-foreground">Loading commentary…</p>}
        {state === "empty" && (
          <p className="text-muted-foreground">
            No commentary available here for this chapter (or you’re offline and it isn’t cached yet).
            Try another source above.
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
                  Verse {b.verse}
                </div>
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
    </aside>
  );
}

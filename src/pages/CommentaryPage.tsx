import { ChevronLeft, ChevronRight } from "lucide-react";
import { ChapterPicker } from "@/components/bible/ChapterPicker";
import { CommentarySourceSelect, CommentaryView, useCommentarySources } from "@/components/bible/CommentaryView";
import { useUI } from "@/store/ui";
import { useChapterNav } from "@/lib/useChapterNav";
import { refLabel } from "@/lib/osis";
import { Button, Tooltip } from "@/components/ui";

/**
 * A dedicated, full-width home for the commentaries — the same pluggable sources and
 * view as the Bible study rail's Commentary tab (src/components/bible/CommentaryView),
 * but with room to read.
 */
export function CommentaryPage() {
  const { ho, chapter, commentarySource, goTo } = useUI();
  const { step, canPrev, canNext } = useChapterNav();
  const sources = useCommentarySources();

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-background/80 px-3 py-2.5 backdrop-blur md:px-4 md:py-3">
        <ChapterPicker />
        <div className="flex items-center gap-1">
          <Tooltip label="Previous chapter">
            <Button variant="ghost" size="icon" onClick={() => step(-1)} disabled={!canPrev} aria-label="Previous chapter">
              <ChevronLeft size={18} />
            </Button>
          </Tooltip>
          <Tooltip label="Next chapter">
            <Button variant="ghost" size="icon" onClick={() => step(1)} disabled={!canNext} aria-label="Next chapter">
              <ChevronRight size={18} />
            </Button>
          </Tooltip>
        </div>
        <CommentarySourceSelect sources={sources} hideLabel className="ml-auto w-full min-[520px]:w-64" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 py-6 md:px-8">
          <h1 className="mb-5 font-serif text-2xl font-bold">
            {refLabel(ho, chapter)}
            <span className="ml-2 align-middle font-sans text-sm font-normal text-muted-foreground">
              · {sources.find((s) => s.id === commentarySource)?.name}
            </span>
          </h1>
          <CommentaryView ho={ho} chapter={chapter} sources={sources} onOpenRef={(h, c, v) => goTo(h, c, v)} />
        </div>
      </div>
    </div>
  );
}

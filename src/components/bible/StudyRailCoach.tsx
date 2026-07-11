import { BookMarked, MoveHorizontal, X } from "lucide-react";
import { useUI } from "@/store/ui";

/**
 * A gentle, one-off discovery hint for the study rail on touch tablets/folds,
 * where the commentary panel no longer opens by default (it crowds the reader).
 *
 * - step "toggle": a callout pointing at the header's study-panel button. It is
 *   deliberately NON-blocking (pointer-events only on the card) so the real
 *   button underneath stays tappable — tapping it opens the rail and advances us.
 * - step "resize": once the rail is open, a tap-anywhere-to-dismiss hint pointing
 *   at the drag handle on the rail's left edge.
 */
export function StudyRailCoach({
  step,
  onDismiss,
}: {
  step: "toggle" | "resize";
  onDismiss: () => void;
}) {
  const railWidth = useUI((s) => s.railWidth);

  if (step === "toggle") {
    return (
      <div className="pointer-events-none fixed inset-0 z-50">
        <div className="pointer-events-auto absolute right-2 top-14 w-60 md:top-16">
          <div className="mr-3 flex justify-end">
            <div className="h-3 w-3 -mb-1.5 rotate-45 rounded-[2px] border-l border-t border-primary/40 bg-card" />
          </div>
          <div className="rounded-xl border border-primary/40 bg-card p-3 shadow-card">
            <div className="flex items-start gap-2">
              <BookMarked style={{ width: 18, height: 18 }} className="mt-0.5 shrink-0 text-primary-600" />
              <div className="min-w-0">
                <div className="text-sm font-semibold">Commentary &amp; more, right here</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Verse-by-verse commentary, cross-references and Strong&apos;s word study — tap to open it.
                </div>
              </div>
              <button
                onClick={onDismiss}
                aria-label="Dismiss"
                className="-mr-1 -mt-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // step === "resize" — tap anywhere to dismiss.
  return (
    <div className="fixed inset-0 z-50" onClick={onDismiss}>
      <div
        className="absolute w-56 -translate-y-1/2"
        style={{ top: "50%", right: railWidth + 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-xl border border-primary/40 bg-card p-3 shadow-card">
          <div className="flex items-start gap-2">
            <MoveHorizontal style={{ width: 18, height: 18 }} className="mt-0.5 shrink-0 text-primary-600" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">Drag to resize</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Pull the panel&apos;s left edge to make it wider or narrower. Double-tap the edge to reset.
              </div>
            </div>
          </div>
          <div className="mt-2 text-center text-[11px] text-muted-foreground">Tap anywhere to dismiss</div>
        </div>
      </div>
    </div>
  );
}

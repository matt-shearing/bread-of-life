import { ArrowLeft, X } from "lucide-react";
import { useUI } from "@/store/ui";
import { useReturnFromRef } from "@/lib/useOpenRef";

/**
 * "Back to <where you were>" after following a reference from a devotional, a journal
 * entry, a search result or a cross-reference. While it shows, your own reading
 * position is left untouched; "Stay here" dismisses it and makes this your place.
 */
export function ReturnChip() {
  const returnTo = useUI((s) => s.returnTo);
  const setReturnTo = useUI((s) => s.setReturnTo);
  const back = useReturnFromRef();
  if (!returnTo) return null;
  return (
    <div className="flex justify-center border-b border-border bg-primary/5 px-3 py-1">
      <div role="status" className="flex max-w-full items-center gap-1 text-sm">
        <button
          onClick={back}
          className="flex min-h-9 min-w-0 items-center gap-1.5 rounded-full px-3 font-medium text-primary-700 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-primary-300"
        >
          <ArrowLeft size={16} className="shrink-0" />
          <span className="truncate">Back to {returnTo.label}</span>
        </button>
        <button
          onClick={() => setReturnTo(null)}
          aria-label="Stay here"
          title="Stay here"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

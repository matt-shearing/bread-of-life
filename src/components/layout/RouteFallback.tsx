import { useEffect, useState } from "react";

/**
 * Shown while a route's code chunk loads. Chunks come from local disk in the
 * app, so this is usually on screen for a frame or two — it stays blank for the
 * first moment and only then fades in a quiet line, so fast loads don't flash.
 */
export function RouteFallback() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 250);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
      <p
        className="text-sm text-muted-foreground transition-opacity duration-500"
        style={{ opacity: show ? 1 : 0 }}
      >
        Loading…
      </p>
    </div>
  );
}

/**
 * Is this a touch-primary device (phone, tablet, or an unfolded Pixel Fold)?
 *
 * Used to decide whether the Bible study rail should auto-open: a real desktop with
 * a mouse gets the rich default-open panel; a touch device at the same ≥md width
 * would just have its reader crushed, so it stays closed (with a discovery coach).
 *
 * We deliberately combine signals rather than trust one media query. An Android
 * WebView (which is what the Tauri app runs inside on the Fold) reliably reports a
 * NON-zero `navigator.maxTouchPoints` on its touchscreen — that's the strongest tell.
 * `(pointer: coarse)` / `(hover: none)` back it up. Any one being true → treat as touch.
 */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  const mm = typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null;
  const coarse = mm ? mm("(pointer: coarse)").matches : false;
  const noHover = mm ? mm("(hover: none)").matches : false;
  const touchPoints = typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0;
  return coarse || noHover || touchPoints;
}

/** True on a genuine desktop: a wide viewport that is NOT a touch device. */
export function isDesktopMouse(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(min-width: 768px)").matches && !isTouchDevice();
}

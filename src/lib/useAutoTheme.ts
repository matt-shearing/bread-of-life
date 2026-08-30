import { useEffect } from "react";
import { useUI } from "@/store/ui";
import { nextSunThemeChange, resolveTheme } from "@/lib/theme";

/**
 * Keeps `resolvedTheme` honest for the two auto modes. Mount this ONCE (AppShell
 * does) — it is the only writer of `resolvedTheme`, and everything else in the app
 * just reads it.
 *
 * A pinned Light/Dark needs nothing watched: `theme` already IS the answer, so the
 * effect resolves once and returns. The auto modes each need a different kind of
 * nudge:
 *
 *  - `system` — `prefers-color-scheme` fires a media-query `change` event the
 *    instant the OS flips, so we subscribe and clean up. (The old `addListener`
 *    branch is there for the Android WebView, which is not always new enough for
 *    `addEventListener` on a MediaQueryList.)
 *
 *  - `sun` — nothing tells us the sun moved, so we schedule a timer to the next
 *    crossing. But `setTimeout` is not a clock: it doesn't run while a laptop is
 *    suspended, and it doesn't survive an NTP step or a manual clock change. So we
 *    cap the wait at 30 minutes and re-arm, and we also re-check whenever the
 *    window comes back to the foreground — a machine that was asleep at sunset
 *    lands on the desk already correct rather than an hour later.
 *
 * Re-checking is free: `setResolvedTheme` bails out when the answer hasn't changed,
 * so an idle app in auto-sun mode re-renders nothing between dawn and dusk.
 */
export function useAutoTheme(): void {
  const mode = useUI((s) => s.theme);
  const location = useUI((s) => s.themeLocation);
  const setResolvedTheme = useUI((s) => s.setResolvedTheme);

  useEffect(() => {
    const apply = () => setResolvedTheme(resolveTheme(mode, location));
    apply();

    if (mode === "light" || mode === "dark") return; // a pin never moves

    const cleanups: (() => void)[] = [];

    if (mode === "system") {
      const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
      if (mq?.addEventListener) {
        mq.addEventListener("change", apply);
        cleanups.push(() => mq.removeEventListener("change", apply));
      } else if (mq?.addListener) {
        mq.addListener(apply);
        cleanups.push(() => mq.removeListener(apply));
      }
    }

    if (mode === "sun") {
      let timer: number | undefined;
      const arm = () => {
        const wait = Math.min(Math.max(nextSunThemeChange(location).getTime() - Date.now(), 1_000), 30 * 60_000);
        timer = window.setTimeout(() => {
          apply();
          arm();
        }, wait);
      };
      arm();
      cleanups.push(() => {
        if (timer !== undefined) window.clearTimeout(timer);
      });
    }

    // Both auto modes want this: coming back from a suspend, another workspace, or
    // a backgrounded phone is the moment we are most likely to be showing a stale
    // answer, and it is the moment the user is about to look at the screen.
    window.addEventListener("focus", apply);
    document.addEventListener("visibilitychange", apply);
    cleanups.push(() => {
      window.removeEventListener("focus", apply);
      document.removeEventListener("visibilitychange", apply);
    });

    return () => cleanups.forEach((off) => off());
  }, [mode, location, setResolvedTheme]);
}

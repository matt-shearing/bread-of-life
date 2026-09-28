import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useUI } from "@/store/ui";
import { isTouchDevice } from "@/lib/device";

/**
 * Layout decisions for the three screens Bread of Life really runs on:
 *   - the Pixel Fold's cover screen (~412px, touch)       → phone layout (< md)
 *   - the Fold unfolded (~832px, touch)                   → COMPACT layout
 *   - a desktop window (1440px, mouse)                    → full layout
 *
 * "Compact" = narrower than 1024px OR a touch screen. There the sidebar starts
 * collapsed and the study rail floats over the reader instead of docking beside it.
 */
export const COMPACT_MAX_PX = 1023;
export const PHONE_MAX_PX = 767;

/** Live `matchMedia` result. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function usePhoneLayout(): boolean {
  return useMediaQuery(`(max-width: ${PHONE_MAX_PX}px)`);
}

/** True on touch screens (any width) and on windows narrower than 1024px. */
export function useCompactLayout(): boolean {
  const narrow = useMediaQuery(`(max-width: ${COMPACT_MAX_PX}px)`);
  const coarse = useMediaQuery("(pointer: coarse)");
  const [touch] = useState(() => isTouchDevice());
  return narrow || coarse || touch;
}

/** True where a tap (not a hover-capable mouse) is the primary input. */
export function useCoarsePointer(): boolean {
  const coarse = useMediaQuery("(pointer: coarse)");
  const [touch] = useState(() => isTouchDevice());
  return coarse || touch;
}

/** Is the reader on screen (so the study rail may be open beside it)? */
function useOnReaderRoute(): boolean {
  const { pathname } = useLocation();
  return pathname.startsWith("/bible") || pathname.startsWith("/guided");
}

/**
 * Whether the sidebar is collapsed right now. On compact layouts it follows the
 * compact preference (collapsed until the user expands it), and it is forced
 * collapsed while the study rail is open over the reader — otherwise sidebar +
 * rail left the Fold's scripture column about 200px wide.
 */
export function useSidebarCollapsed(): { collapsed: boolean; compact: boolean; forced: boolean; toggle: () => void } {
  const compact = useCompactLayout();
  const onReader = useOnReaderRoute();
  const { sidebarCollapsed, sidebarCompactPref, railOpen, toggleSidebar, setSidebarCompactPref, setRailOpen } = useUI();
  const forced = compact && onReader && railOpen;
  const chosen = compact ? (sidebarCompactPref ?? true) : sidebarCollapsed;
  const collapsed = forced || chosen;
  const toggle = () => {
    if (forced) {
      // Asking for the sidebar while the rail holds its space: give the space back.
      setRailOpen(false);
      setSidebarCompactPref(false);
    } else if (compact) setSidebarCompactPref(!collapsed);
    else toggleSidebar();
  };
  return { collapsed, compact, forced, toggle };
}

/** Width of the app's <main> column (everything right of the sidebar). */
export function useMainWidth(): number {
  const [w, setW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1024));
  useEffect(() => {
    const el = document.getElementById("app-main");
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return w;
}

export type RailMode = "sheet" | "overlay" | "docked";

/** The rail never takes more than this share of the main column. */
export const RAIL_MAX_SHARE = 0.4;
export const RAIL_MIN_PX = 260;

/**
 * THE one place the study rail's on-screen width is decided (S9). Everything that
 * has to make room for the rail — the reader, the guided reader's button bar, the
 * discovery coach — reads it from here instead of assuming 360px.
 *
 *  - sheet   (< 768px): full-screen panel over everything; width = the viewport.
 *  - overlay (768–1023px): floats over the right of the reader; the reading column
 *            is padded by the same width so no verse hides underneath.
 *  - docked  (≥ 1024px): sits beside the reader and can be dragged wider.
 * Overlay and docked are both capped at 40% of the main column.
 */
export function useRailLayout(): { mode: RailMode; width: number; open: boolean; reserve: number } {
  const phone = usePhoneLayout();
  const narrow = useMediaQuery(`(max-width: ${COMPACT_MAX_PX}px)`);
  const mainWidth = useMainWidth();
  const { railWidth, railOpen } = useUI();
  const mode: RailMode = phone ? "sheet" : narrow ? "overlay" : "docked";
  const cap = Math.max(RAIL_MIN_PX, Math.floor(mainWidth * RAIL_MAX_SHARE));
  const width = mode === "sheet" ? mainWidth : Math.min(railWidth, cap);
  // Space the page must leave on its right for the rail (0 when closed or a sheet).
  const reserve = railOpen && mode !== "sheet" ? width : 0;
  return { mode, width, open: railOpen, reserve };
}

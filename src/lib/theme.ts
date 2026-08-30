/**
 * Theme resolution — turning "how should the theme be chosen?" into "light or dark,
 * right now".
 *
 * Deliberately pure and store-free (the *store* imports this, not the other way
 * round) so `src/store/ui.ts` can call `resolveTheme` inside its persist `merge`
 * and paint the correct theme on the very first frame. The listeners and timers
 * that keep the auto modes honest live in `src/lib/useAutoTheme.ts`.
 *
 * Everything here is DEVICE-LOCAL. The mode and the saved location ride in the
 * `bol-ui` localStorage blob and are pointedly absent from `src/store/syncedPrefs.ts`:
 * "dark after sunset" means a different thing on a phone in Brisbane than on a
 * desktop in London, and a coordinate is not something to push at a server.
 */
import { isDaylight, locationForTimezone, nextSunTransition } from "@/lib/sun";

/**
 * How the theme is chosen.
 *  - `light` / `dark` — manual pins. They never auto-flip. These are also the two
 *    values every pre-existing install has persisted, which is why the union was
 *    widened in place instead of a new key being invented.
 *  - `system` — follow the OS's `prefers-color-scheme`, live.
 *  - `sun`    — light between sunrise and sunset where you are, dark otherwise.
 */
export type ThemeMode = "light" | "dark" | "system" | "sun";

/** What is actually painted. The auto modes collapse to one of these. */
export type ResolvedTheme = "light" | "dark";

/** A coordinate the user has pinned for auto-sun mode. Never synced, never sent. */
export interface ThemeLocation {
  lat: number;
  lon: number;
  /** Short human label for Settings, e.g. "This device" or "Set by hand". */
  label: string;
  source: "manual" | "device";
}

/** The location auto-sun will actually use, plus where it came from. */
export interface EffectiveLocation {
  lat: number;
  lon: number;
  label: string;
  source: "manual" | "device" | "timezone";
  /** True when we are guessing from a UTC offset rather than a known place. */
  approximate: boolean;
}

const MODES: readonly ThemeMode[] = ["light", "dark", "system", "sun"];

/** Coerce whatever came out of localStorage into a mode we understand. */
export function normalizeThemeMode(value: unknown): ThemeMode {
  return MODES.includes(value as ThemeMode) ? (value as ThemeMode) : "light";
}

/** Is the OS asking for a dark UI? Falsey on anything that can't tell us. */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/**
 * Which coordinate auto-sun should use, in priority order:
 *   1. a location the user saved on this device (typed in, or granted once), then
 *   2. the machine's IANA time zone.
 * There is no third step — we never ask the network where the user is.
 */
export function effectiveLocation(saved: ThemeLocation | null, now: Date = new Date()): EffectiveLocation {
  if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
    return { lat: saved.lat, lon: saved.lon, label: saved.label, source: saved.source, approximate: false };
  }
  const tz = locationForTimezone(now);
  return { lat: tz.lat, lon: tz.lon, label: tz.label, source: "timezone", approximate: tz.approximate };
}

/** Light or dark, right now, for this mode. */
export function resolveTheme(
  mode: ThemeMode,
  saved: ThemeLocation | null,
  now: Date = new Date(),
): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  const { lat, lon } = effectiveLocation(saved, now);
  return isDaylight(now, lat, lon) ? "light" : "dark";
}

/** When auto-sun will next want to change the theme. */
export function nextSunThemeChange(saved: ThemeLocation | null, now: Date = new Date()): Date {
  const { lat, lon } = effectiveLocation(saved, now);
  return nextSunTransition(now, lat, lon);
}

/**
 * Ask the device where it is, once, because the user pressed a button.
 *
 * This fails a lot, and quietly, which is why the promise is wrapped so tightly:
 *  - in a browser the user can simply say no;
 *  - on Linux/WebKitGTK the position provider is geoclue, an OPTIONAL dependency of
 *    webkit2gtk that plenty of distributions leave out. Without it WebKit can
 *    answer "position unavailable" — or call neither callback at all and leave the
 *    promise hanging forever, which is why we race it against our own timer.
 * Every path ends in either a location or an Error carrying a sentence a human can
 * act on. Never a silent no-op.
 */
export function requestDeviceLocation(timeoutMs = 12_000): Promise<ThemeLocation> {
  return new Promise((resolve, reject) => {
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geo) {
      reject(new Error("This device doesn’t offer a location service to the app. Type a latitude and longitude instead."));
      return;
    }

    let settled = false;
    const bail = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Locating timed out — nothing answered. Type a latitude and longitude instead."));
    }, timeoutMs);

    geo.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(bail);
        // Three decimals is ~110 m. A sunrise cannot tell the difference between
        // that and a doorstep, so we round: no reason to keep a precise home
        // address sitting in localStorage.
        resolve({
          lat: round3(pos.coords.latitude),
          lon: round3(pos.coords.longitude),
          label: "This device",
          source: "device",
        });
      },
      (err) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(bail);
        reject(new Error(describeGeoError(err)));
      },
      // Low accuracy on purpose: a city is plenty, and it avoids waking the GPS.
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 3_600_000 },
    );
  });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function describeGeoError(err: GeolocationPositionError): string {
  switch (err.code) {
    case 1: // PERMISSION_DENIED
      return "Location permission was denied. Type a latitude and longitude instead.";
    case 2: // POSITION_UNAVAILABLE
      return "No location service answered. On Linux this usually means geoclue isn’t installed — type a latitude and longitude instead.";
    case 3: // TIMEOUT
      return "Locating took too long. Try again, or type a latitude and longitude instead.";
    default:
      return err.message || "Couldn’t get a location from this device.";
  }
}

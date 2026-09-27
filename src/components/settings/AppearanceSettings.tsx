import { useEffect, useState } from "react";
import { useUI } from "@/store/ui";
import { Button, Card, CardContent, CardHeader, CardTitle, ChipGroup, Input } from "@/components/ui";
import { effectiveLocation, requestDeviceLocation, type ThemeMode } from "@/lib/theme";
import { sunTimes } from "@/lib/sun";

/** The four ways the theme can be decided, in the order they're offered. */
const THEME_MODES: { id: ThemeMode; label: string; hint: string }[] = [
  { id: "light", label: "Light", hint: "Always light." },
  { id: "dark", label: "Dark", hint: "Always dark." },
  { id: "system", label: "Auto — system", hint: "Follows your device’s light or dark setting." },
  { id: "sun", label: "Auto — sun", hint: "Light from sunrise, dark from sunset where you are." },
];

const LOCATION_SOURCE: Record<"manual" | "device" | "timezone", string> = {
  manual: "typed in",
  device: "from this device",
  timezone: "from your time zone",
};

export function AppearanceSettings() {
  const { theme, setTheme, resolvedTheme, fontScale, setFontScale } = useUI();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 text-sm font-medium">Theme</div>
          <ChipGroup
            label="Theme"
            value={theme}
            onValueChange={(v) => v && setTheme(v)}
            options={THEME_MODES.map((m) => ({ value: m.id, label: m.label }))}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {THEME_MODES.find((m) => m.id === theme)?.hint}
            {(theme === "system" || theme === "sun") && ` Right now it’s ${resolvedTheme}.`} The sun and moon
            button in the menu flips it by hand and turns Auto off. Kept on this device only.
          </p>
        </div>

        {theme === "sun" && <SunLocation />}

        <div className="flex items-center justify-between gap-3">
          <span id="font-scale-label" className="text-sm font-medium">
            Scripture text size
          </span>
          <div className="flex items-center gap-2" role="group" aria-labelledby="font-scale-label">
            <Button variant="outline" size="icon" onClick={() => setFontScale(fontScale - 0.05)} aria-label="Smaller text">
              A-
            </Button>
            <span className="w-12 text-center text-sm text-muted-foreground" aria-live="polite">
              {Math.round(fontScale * 100)}%
            </span>
            <Button variant="outline" size="icon" onClick={() => setFontScale(fontScale + 0.05)} aria-label="Larger text">
              A+
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The auto-sun detail panel: the location we're using, what that makes today's
 * sunrise and sunset, and the two ways to correct it (ask the device once, or
 * type a coordinate). Shown only while "Auto — sun" is the chosen mode.
 */
function SunLocation() {
  const themeLocation = useUI((s) => s.themeLocation);
  const setThemeLocation = useUI((s) => s.setThemeLocation);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the boxes from whatever is in force, so "Use my location" visibly
  // fills them in and you can see (and edit) exactly what got stored.
  useEffect(() => {
    const l = effectiveLocation(themeLocation);
    setLat(l.lat.toFixed(3));
    setLon(l.lon.toFixed(3));
  }, [themeLocation]);

  const loc = effectiveLocation(themeLocation);
  const today = sunTimes(new Date(), loc.lat, loc.lon);
  const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  async function locate() {
    setBusy(true);
    setError(null);
    try {
      setThemeLocation(await requestDeviceLocation());
    } catch (e) {
      // Geolocation fails often and for boring reasons (denied, or no geoclue on
      // this Linux box). Say so on screen — a button that appears to do nothing is
      // worse than one that explains itself.
      setError(e instanceof Error ? e.message : "Couldn’t get a location from this device.");
    } finally {
      setBusy(false);
    }
  }

  function saveTyped() {
    const la = Number(lat.trim());
    const lo = Number(lon.trim());
    if (!lat.trim() || !lon.trim() || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      setError("Latitude runs from −90 to 90, longitude from −180 to 180. East and north are positive.");
      return;
    }
    setError(null);
    setThemeLocation({ lat: la, lon: lo, label: "Set by hand", source: "manual" });
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-background/60 p-3">
      <div className="text-sm">
        Using <span className="font-medium">{loc.label}</span>{" "}
        <span className="text-muted-foreground">
          ({LOCATION_SOURCE[loc.source]} · {loc.lat.toFixed(2)}, {loc.lon.toFixed(2)})
        </span>
      </div>

      <div className="text-sm text-muted-foreground">
        {today.polar === "day" ? (
          "The sun doesn’t set here today — staying light."
        ) : today.polar === "night" ? (
          "The sun doesn’t rise here today — staying dark."
        ) : (
          <>
            Sunrise <span className="font-medium text-foreground">{clock(today.sunrise)}</span> · Sunset{" "}
            <span className="font-medium text-foreground">{clock(today.sunset)}</span>
          </>
        )}
      </div>

      {loc.approximate && (
        <p className="text-xs text-muted-foreground">
          Your time zone isn’t one we know a city for, so this is a rough guess from your UTC offset
          — near enough to 6am and 6pm all year. Set a location below to make it real.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={locate} disabled={busy}>
          {busy ? "Locating…" : "Use my location"}
        </Button>
        {themeLocation && (
          <Button variant="ghost" size="sm" onClick={() => setThemeLocation(null)}>
            Forget it, use my time zone
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          Latitude
          <Input
            className="mt-1 h-9 w-28"
            inputMode="decimal"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Longitude
          <Input
            className="mt-1 h-9 w-28"
            inputMode="decimal"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
          />
        </label>
        <Button variant="outline" size="sm" onClick={saveTyped}>
          Save
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <p className="text-xs text-muted-foreground">
        Only ever used to work out sunrise and sunset. It stays on this device — it isn’t synced and
        isn’t sent anywhere.
      </p>
    </div>
  );
}

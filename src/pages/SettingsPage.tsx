import { useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import { db } from "@/db";
import { useUI } from "@/store/ui";
import { COMMENTARY_SOURCES } from "@/data/commentary";
import { enablePrayerNotifications } from "@/lib/notify";
import { requestFeature, reportBug } from "@/lib/feedback";
import { SyncSettings } from "@/components/settings/SyncSettings";
import { E2ESettings } from "@/components/settings/E2ESettings";
import { MisslerSettings } from "@/components/settings/MisslerSettings";
import { version as APP_VERSION } from "../../package.json";
import { PROVIDERS } from "@/ai/client";
import type { AIProvider } from "@/store/ui";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { effectiveLocation, requestDeviceLocation, type ThemeMode } from "@/lib/theme";
import { sunTimes } from "@/lib/sun";
import { MAX_READING_SLOTS, type ReminderSlot } from "@/lib/readingReminders";

/** The four ways the theme can be decided, in the order they're offered. */
const THEME_MODES: { id: ThemeMode; label: string; hint: string }[] = [
  { id: "light", label: "Light", hint: "Always light, whatever the hour." },
  { id: "dark", label: "Dark", hint: "Always dark, whatever the hour." },
  {
    id: "system",
    label: "Auto — system",
    hint: "Follows your device’s own light/dark setting, and changes the moment it does.",
  },
  {
    id: "sun",
    label: "Auto — sun",
    hint: "Light from sunrise, dark from sunset, worked out for where you are.",
  },
];

const LOCATION_SOURCE: Record<"manual" | "device" | "timezone", string> = {
  manual: "typed in",
  device: "from this device",
  timezone: "from your time zone",
};

export function SettingsPage() {
  const {
    theme,
    setTheme,
    resolvedTheme,
    fontScale,
    setFontScale,
    commentarySource,
    setCommentarySource,
    notifyPrayers,
    setNotifyPrayers,
    notifyDevotion,
    devotionTime,
    setNotifyDevotion,
    setDevotionTime,
    notifyMemory,
    setNotifyMemory,
    reminderTime,
    setReminderTime,
    ai,
    setAI,
  } = useUI();
  const aiMeta = PROVIDERS[ai.provider];
  const counts = useLiveQuery(
    async () => ({
      highlights: await db.highlights.count(),
      notes: await db.notes.count(),
      prayers: await db.prayers.count(),
      journal: await db.journal.count(),
    }),
    [],
    { highlights: 0, notes: 0, prayers: 0, journal: 0 },
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">
        <h1 className="mb-6 font-serif text-3xl font-bold">Settings</h1>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-2 text-sm">Theme</div>
                <div className="flex flex-wrap gap-2">
                  {THEME_MODES.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setTheme(m.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-sm",
                        theme === m.id
                          ? "border-primary bg-primary/10 text-primary-700 dark:text-primary-300"
                          : "border-border text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {THEME_MODES.find((m) => m.id === theme)?.hint}
                  {(theme === "system" || theme === "sun") && ` Right now it’s ${resolvedTheme}.`}
                </p>
              </div>

              {theme === "sun" && <SunLocation />}

              <p className="text-xs text-muted-foreground">
                The sun/moon button in the sidebar — and “Dark”/“Light” under More on your phone —
                is a quick pin: it switches to the opposite of what you’re looking at and stops
                following anything. Auto is set here. Either way your theme stays on this device and
                is never synced.
              </p>

              <Row label="Scripture text size">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => setFontScale(fontScale - 0.05)}>
                    A-
                  </Button>
                  <span className="w-12 text-center text-sm text-muted-foreground">{Math.round(fontScale * 100)}%</span>
                  <Button variant="outline" size="icon" onClick={() => setFontScale(fontScale + 0.05)}>
                    A+
                  </Button>
                </div>
              </Row>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Default commentary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {COMMENTARY_SOURCES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setCommentarySource(s.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm",
                      commentarySource === s.id
                        ? "border-primary bg-primary/10 text-primary-700 dark:text-primary-300"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reminders</CardTitle>
            </CardHeader>
            <CardContent>
              <Row label="Daily prayer reminders">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (notifyPrayers) {
                      setNotifyPrayers(false);
                    } else {
                      // Best-effort OS permission, but always flip on — on webviews
                      // where the Notification API is unavailable/denied the toggle
                      // must still switch, or it looks stuck.
                      await enablePrayerNotifications();
                      setNotifyPrayers(true);
                    }
                  }}
                >
                  {notifyPrayers ? "On" : "Off"}
                </Button>
              </Row>
              <p className="mt-2 text-xs text-muted-foreground">
                Prayers you mark with the bell show up on your dashboard until you’ve prayed for them
                that day. When on, you’ll also get a notification when you open the app.
              </p>

              <div className="mt-4 border-t border-border pt-4">
                <Row label="Devotional reminder">
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={devotionTime}
                      onChange={(e) => setDevotionTime(e.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        if (notifyDevotion) {
                          setNotifyDevotion(false);
                        } else {
                          await enablePrayerNotifications();
                          setNotifyDevotion(true);
                        }
                      }}
                    >
                      {notifyDevotion ? "On" : "Off"}
                    </Button>
                  </div>
                </Row>
                <p className="mt-2 text-xs text-muted-foreground">
                  At this time each day you’ll be reminded to read your Spurgeon devotional (while the
                  app is open).
                </p>
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <Row label="Memory verse reminder">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (notifyMemory) {
                        setNotifyMemory(false);
                      } else {
                        await enablePrayerNotifications();
                        setNotifyMemory(true);
                      }
                    }}
                  >
                    {notifyMemory ? "On" : "Off"}
                  </Button>
                </Row>
                <p className="mt-2 text-xs text-muted-foreground">
                  A gentle daily nudge to review the verses you’re hiding in your heart, whenever cards
                  are due in Memory Lane.
                </p>
              </div>

              <ReadingReminderSettings />

              <div className="mt-4 border-t border-border pt-4">
                <Row label="Reminder time">
                  <input
                    type="time"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                </Row>
                <p className="mt-2 text-xs text-muted-foreground">
                  When your prayer and memory-verse reminders arrive each day. In the Android app
                  these are scheduled with your phone, so they can reach you even when Bread of Life
                  isn’t open.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI study companion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-2 text-sm">Provider</div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(PROVIDERS) as AIProvider[]).map((p) => (
                    <button
                      key={p}
                      onClick={() =>
                        setAI({
                          provider: p,
                          model: PROVIDERS[p].defaultModel,
                          baseUrl: PROVIDERS[p].defaultBaseUrl ?? "",
                        })
                      }
                      className={cn(
                        "rounded-full border px-3 py-1 text-sm",
                        ai.provider === p
                          ? "border-primary bg-primary/10 text-primary-700 dark:text-primary-300"
                          : "border-border text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {PROVIDERS[p].label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 text-sm">Model</div>
                <Input
                  list="ai-model-suggestions"
                  value={ai.model}
                  onChange={(e) => setAI({ model: e.target.value })}
                  placeholder={aiMeta.defaultModel || "model id"}
                />
                <datalist id="ai-model-suggestions">
                  {aiMeta.modelSuggestions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              {(aiMeta.needsKey || ai.provider === "custom") && (
                <div>
                  <div className="mb-1 text-sm">API key {aiMeta.needsKey ? "" : "(optional)"}</div>
                  <Input
                    type="password"
                    value={ai.apiKey}
                    onChange={(e) => setAI({ apiKey: e.target.value })}
                    placeholder={aiMeta.keyHint ?? "API key"}
                  />
                </div>
              )}

              {aiMeta.needsBaseUrl && (
                <div>
                  <div className="mb-1 text-sm">Base URL</div>
                  <Input
                    value={ai.baseUrl}
                    onChange={(e) => setAI({ baseUrl: e.target.value })}
                    placeholder={aiMeta.defaultBaseUrl ?? "https://…/v1"}
                  />
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Your key is stored locally on this device and used only to call your chosen provider.
                In the desktop app requests go out natively (no CORS); OpenAI/custom providers may be
                blocked by CORS in a plain browser.
              </p>
            </CardContent>
          </Card>

          <MisslerSettings />

          <SyncSettings />

          <E2ESettings />

          <Card>
            <CardHeader>
              <CardTitle>Your data</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>{counts.highlights} highlights · {counts.notes} notes · {counts.prayers} prayers · {counts.journal} journal entries</p>
              <p className="pt-2 text-xs">
                Everything is stored locally on this device (offline-first). Scripture is the Berean
                Standard Bible, public domain (CC0).
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Feedback</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Have an idea, or something you'd love the app to do? Requests are read and turned into
                real changes.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={requestFeature}>🌱 Request a feature</Button>
                <Button variant="outline" onClick={reportBug}>
                  Report a bug
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Opens a pre-filled issue on GitHub (needs a free GitHub account).
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>Bread of Life · v{APP_VERSION} — a warm, offline-first homebase for reading, prayer, and journalling.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
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

/**
 * Daily-reading reminders: a switch plus up to four clock times, each of which can be
 * turned off. Stored per device (see src/store/syncedPrefs.ts).
 */
function ReadingReminderSettings() {
  const notifyPlan = useUI((s) => s.notifyPlan);
  const setNotifyPlan = useUI((s) => s.setNotifyPlan);
  const slots = useUI((s) => s.readingReminderSlots);
  const setSlots = useUI((s) => s.setReadingReminderSlots);
  const activePlanId = useUI((s) => s.activePlanId);

  const update = (i: number, patch: Partial<ReminderSlot>) =>
    setSlots(slots.map((slot, j) => (j === i ? { ...slot, ...patch } : slot)));

  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="reading-reminders">
      <Row label="Daily reading reminders">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={notifyPlan}
          onClick={async () => {
            if (notifyPlan) {
              setNotifyPlan(false);
            } else {
              await enablePrayerNotifications();
              setNotifyPlan(true);
            }
          }}
        >
          {notifyPlan ? "On" : "Off"}
        </Button>
      </Row>
      <p className="mt-2 text-xs text-muted-foreground">
        A reminder to do today’s reading if you haven’t yet. Once it’s done, the rest of today’s
        reminders are skipped. When you’re on a reading streak of two days or more, the reminder
        says so. These times apply to this device only.
      </p>

      {notifyPlan && (
        <div className="mt-3 space-y-2">
          {slots.map((slot, i) => (
            <div key={i} className="flex max-w-xs items-center gap-2" data-testid="reading-reminder-slot">
              <input
                type="time"
                aria-label={`Reminder ${i + 1} time`}
                value={slot.time}
                onChange={(e) => e.target.value && update(i, { time: e.target.value })}
                className={cn(
                  "h-9 rounded-md border border-input bg-background px-2 text-sm",
                  !slot.enabled && "text-muted-foreground line-through",
                )}
              />
              <Button
                variant="outline"
                size="sm"
                aria-label={`Reminder ${i + 1} ${slot.enabled ? "on" : "off"}`}
                aria-pressed={slot.enabled}
                onClick={() => update(i, { enabled: !slot.enabled })}
              >
                {slot.enabled ? "On" : "Off"}
              </Button>
              {slots.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-8 w-8"
                  aria-label={`Remove reminder ${i + 1}`}
                  title="Remove this time"
                  onClick={() => setSlots(slots.filter((_, j) => j !== i))}
                >
                  <X style={{ width: 16, height: 16 }} />
                </Button>
              )}
            </div>
          ))}
          {slots.length < MAX_READING_SLOTS && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSlots([...slots, { time: "18:00", enabled: true }])}
            >
              Add a time
            </Button>
          )}
          {!activePlanId && (
            <p className="text-xs text-muted-foreground">
              Start a reading plan on the Plans page and these reminders will begin.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

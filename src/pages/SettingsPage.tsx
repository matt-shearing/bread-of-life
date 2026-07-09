import type { ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { useUI } from "@/store/ui";
import { COMMENTARY_SOURCES } from "@/data/commentary";
import { enablePrayerNotifications } from "@/lib/notify";
import { PROVIDERS } from "@/ai/client";
import type { AIProvider } from "@/store/ui";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

export function SettingsPage() {
  const {
    theme,
    toggleTheme,
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
      <div className="mx-auto max-w-2xl px-8 py-8">
        <h1 className="mb-6 font-serif text-3xl font-bold">Settings</h1>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Row label="Theme">
                <Button variant="outline" size="sm" onClick={toggleTheme}>
                  {theme === "light" ? "Light" : "Dark"}
                </Button>
              </Row>
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
                    if (notifyPrayers) setNotifyPrayers(false);
                    else setNotifyPrayers(await enablePrayerNotifications());
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
                        if (notifyDevotion) setNotifyDevotion(false);
                        else setNotifyDevotion(await enablePrayerNotifications());
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
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>Bread of Life · v0.1 — a warm, offline-first homebase for reading, prayer, and journalling.</p>
            </CardContent>
          </Card>
        </div>
      </div>
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

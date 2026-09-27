import { X } from "lucide-react";
import { useUI } from "@/store/ui";
import { ensureNotificationPermission } from "@/lib/notify";
import { MAX_READING_SLOTS, type ReminderSlot } from "@/lib/readingReminders";
import { Button, Card, CardContent, CardHeader, CardTitle, Switch } from "@/components/ui";
import { cn } from "@/lib/cn";

const TIME_INPUT =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11";

/** Turning a reminder on asks for notification permission first (best effort: on
 *  webviews without the Notification API it still switches on, or it looks stuck). */
function withPermission(set: (v: boolean) => void) {
  return async (on: boolean) => {
    if (on) await ensureNotificationPermission();
    set(on);
  };
}

/**
 * Every daily reminder in one block: prayer and memory verses (which share a time),
 * the devotional (its own time) and daily reading (up to four times).
 */
export function ReminderSettings() {
  const {
    notifyPrayers,
    setNotifyPrayers,
    notifyMemory,
    setNotifyMemory,
    reminderTime,
    setReminderTime,
    notifyDevotion,
    setNotifyDevotion,
    devotionTime,
    setDevotionTime,
  } = useUI();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reminders</CardTitle>
        <p className="text-sm text-muted-foreground">
          In the Android app your phone delivers these even when Bread of Life is closed. On a computer
          they appear while the app is open.
        </p>
      </CardHeader>
      <CardContent className="divide-y divide-border [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
        <div className="space-y-3">
          <Switch
            label="Prayer reminders"
            description="Prayers you’ve marked with the bell, until you’ve prayed for them that day."
            checked={notifyPrayers}
            onCheckedChange={withPermission(setNotifyPrayers)}
          />
          <Switch
            label="Memory verses"
            description="A nudge to review when cards are due in Memory Lane."
            checked={notifyMemory}
            onCheckedChange={withPermission(setNotifyMemory)}
          />
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className={cn(!notifyPrayers && !notifyMemory && "text-muted-foreground")}>
              Time for prayer and memory reminders
            </span>
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              className={TIME_INPUT}
            />
          </label>
        </div>

        <Switch
          label="Devotional"
          description="Time to read your Spurgeon devotional."
          checked={notifyDevotion}
          onCheckedChange={withPermission(setNotifyDevotion)}
        >
          <input
            type="time"
            aria-label="Devotional reminder time"
            value={devotionTime}
            onChange={(e) => setDevotionTime(e.target.value)}
            className={TIME_INPUT}
          />
        </Switch>

        <ReadingReminderSettings />
      </CardContent>
    </Card>
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
    <div data-testid="reading-reminders">
      <Switch
        label="Daily reading"
        description="Today’s plan reading, until it’s done; the rest of the day’s times are then skipped. From two days on, it mentions your streak. These times are for this device only."
        checked={notifyPlan}
        onCheckedChange={withPermission(setNotifyPlan)}
      />

      {notifyPlan && (
        <div className="mt-3 space-y-2">
          {slots.map((slot, i) => (
            <div key={i} className="flex max-w-xs items-center gap-3" data-testid="reading-reminder-slot">
              <input
                type="time"
                aria-label={`Reading reminder ${i + 1} time`}
                value={slot.time}
                onChange={(e) => e.target.value && update(i, { time: e.target.value })}
                className={cn(TIME_INPUT, !slot.enabled && "text-muted-foreground line-through")}
              />
              <Switch
                aria-label={`Reading reminder ${i + 1}`}
                checked={slot.enabled}
                onCheckedChange={(on) => update(i, { enabled: on })}
              />
              {slots.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  aria-label={`Remove reading reminder ${i + 1}`}
                  title="Remove this time"
                  onClick={() => setSlots(slots.filter((_, j) => j !== i))}
                >
                  <X size={16} />
                </Button>
              )}
            </div>
          ))}
          {slots.length < MAX_READING_SLOTS && (
            <Button variant="outline" size="sm" onClick={() => setSlots([...slots, { time: "18:00", enabled: true }])}>
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

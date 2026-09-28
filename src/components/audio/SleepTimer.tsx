import { useEffect, useState } from "react";
import { Moon } from "lucide-react";
import {
  hasReadings,
  setSleepTimer,
  sleepRemainingMs,
  SLEEP_MINUTES,
  useAudioSelector,
  type SleepTimer,
} from "@/audio/controller";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/day";

/**
 * The sleep timer's controls: a pill in Now Playing that opens the choices, and a small
 * moon with the time left on the mini-player. The timer itself lives in the audio
 * controller (and natively on Android); these only show it and set it.
 */

/** The timer and the seconds until it pauses (null when not known), updated each second. */
function useSleepCountdown(): { sleep: SleepTimer | null; seconds: number | null; readings: boolean } {
  const { sleep, readings, remaining } = useAudioSelector((s) => {
    const ms = s.sleep && s.sleep.kind !== "time" ? sleepRemainingMs(s) : null;
    return {
      sleep: s.sleep,
      readings: hasReadings(s),
      // Whole seconds, so the time updates re-render this once a second, not on every tick.
      remaining: ms === null ? null : Math.ceil(ms / 1000),
    };
  });
  // A timed timer counts down by the clock, so it needs a clock of its own.
  const [now, setNow] = useState(() => Date.now());
  const timed = sleep?.kind === "time";
  useEffect(() => {
    if (!timed) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timed]);
  const seconds = sleep?.kind === "time" ? Math.max(0, Math.ceil((sleep.endsAt - now) / 1000)) : remaining;
  return { sleep, seconds, readings };
}

function describe(sleep: SleepTimer | null, seconds: number | null): string {
  if (!sleep) return "Sleep timer off";
  const left = seconds !== null ? `, ${formatClock(seconds)} left` : "";
  if (sleep.kind === "time") return `Sleep timer: pauses in ${formatClock(seconds ?? 0)}`;
  return `Sleep timer: pauses at the end of this ${sleep.kind}${left}`;
}

/** Now Playing's sleep timer: a pill beside the speed that opens the choices. */
export function SleepControl() {
  const { sleep, seconds, readings } = useSleepCountdown();
  const [open, setOpen] = useState(false);
  const choose = (choice: Parameters<typeof setSleepTimer>[0]) => {
    setSleepTimer(choice);
    setOpen(false);
  };
  const label = !sleep
    ? "Sleep"
    : sleep.kind === "time"
      ? formatClock(seconds ?? 0)
      : sleep.kind === "chapter"
        ? "End of chapter"
        : "End of reading";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={describe(sleep, seconds)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium tabular-nums shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            sleep
              ? "border-primary/40 bg-primary/10 text-primary-800 hover:bg-primary/15 dark:text-primary-200"
              : "border-border bg-card/70 text-foreground hover:border-primary/40 hover:bg-primary/5",
          )}
        >
          <Moon
            style={{ width: 15, height: 15 }}
            className="text-primary-600 dark:text-primary-400"
            fill={sleep ? "currentColor" : "none"}
          />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" side="top">
        <div className="px-1 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sleep timer</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {sleep
              ? seconds !== null
                ? `Fades out and pauses in ${formatClock(seconds)}`
                : "Fades out and pauses at the end of the reading"
              : "Fades out, then pauses"}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1" role="group" aria-label="Pause after">
          {SLEEP_MINUTES.map((m) => (
            <button
              key={m}
              onClick={() => choose({ minutes: m })}
              className="h-9 rounded-md text-sm font-medium tabular-nums transition-colors hover:bg-accent"
            >
              {m} min
            </button>
          ))}
        </div>
        <div className="mt-1 flex flex-col gap-1 border-t border-border pt-1">
          <OptionRow active={sleep?.kind === "chapter"} onClick={() => choose({ endOf: "chapter" })}>
            End of this chapter
          </OptionRow>
          {readings && (
            <OptionRow active={sleep?.kind === "reading"} onClick={() => choose({ endOf: "reading" })}>
              End of this reading
            </OptionRow>
          )}
          {sleep && (
            <OptionRow onClick={() => choose(null)} muted>
              Turn off
            </OptionRow>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OptionRow({
  active,
  muted,
  onClick,
  children,
}: {
  active?: boolean;
  muted?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active ?? undefined}
      className={cn(
        "h-9 rounded-md px-2.5 text-left text-sm font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "hover:bg-accent",
        muted && "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** The mini-player's reminder that a sleep timer runs: a moon and the time left. */
export function SleepBadge({ className }: { className?: string }) {
  const { sleep, seconds } = useSleepCountdown();
  if (!sleep) return null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-primary-700 dark:text-primary-300", className)}
      title={describe(sleep, seconds)}
      aria-label={describe(sleep, seconds)}
      role="img"
    >
      <Moon style={{ width: 12, height: 12 }} fill="currentColor" aria-hidden="true" />
      {seconds !== null && formatClock(seconds)}
    </span>
  );
}

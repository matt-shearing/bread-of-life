import { Headphones, Loader2, Pause, Play } from "lucide-react";
import { toggle, useAudio } from "@/audio/controller";
import {
  SPOKEN_DEVOTIONAL_ID,
  formatListenDuration,
  playDevotional,
  slotOf,
  useListenMode,
  usePrepareState,
} from "@/audio/devotionalAudio";
import type { DevotionReading } from "@/data/devotional";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * "Listen" for a Spurgeon Morning or Evening reading. Shows the recording's length, or
 * that the device's own voice will read it; while this reading is loaded in the player
 * it becomes pause/resume. Renders nothing for devotionals that are not spoken.
 */
export function ListenButton({
  devotionalId,
  dayKey,
  index,
  reading,
  size = "sm",
  className,
}: {
  devotionalId: string;
  dayKey: string;
  index: number;
  reading: DevotionReading;
  size?: "sm" | "md";
  className?: string;
}) {
  const mode = useListenMode(dayKey, reading);
  const prep = usePrepareState();
  const { queue, index: qi, playing, loading, currentTime, duration: audioDuration } = useAudio();
  const slot = slotOf(reading);
  if (devotionalId !== SPOKEN_DEVOTIONAL_ID || !slot) return null;

  const id = `${slot}/${dayKey}`;
  const cur = queue[qi]?.devotional;
  // Loaded and not yet finished: this button becomes pause/resume. Once it has played to
  // the end, it goes back to "Listen" so a tap starts it again from the top.
  const finished = !playing && audioDuration > 0 && currentTime >= audioDuration - 0.5;
  const isThis = !!cur && cur.devotionalId === devotionalId && cur.day === dayKey && cur.index === index && !finished;
  const preparing = prep.id === id;
  const failed = prep.error?.id === id ? prep.error.message : null;
  const duration = formatListenDuration(mode);
  const icon = { width: 15, height: 15 };

  if (isThis) {
    return (
      <Button size={size} variant="secondary" onClick={toggle} className={className} aria-label={playing ? "Pause the reading" : "Resume the reading"}>
        {loading ? <Loader2 style={icon} className="animate-spin" /> : playing ? <Pause style={icon} /> : <Play style={icon} />}
        {playing ? "Pause" : "Resume"}
      </Button>
    );
  }

  const unavailable = mode.kind === "unavailable";
  const title =
    mode.kind === "recording"
      ? `Listen to the ${slot} reading (${duration})`
      : mode.kind === "device"
        ? "No recording available, so your device's own voice will read it"
        : mode.kind === "unavailable"
          ? mode.reason
          : undefined;

  return (
    <div className={cn("inline-flex flex-col items-start gap-1", className)}>
      <Button
        size={size}
        variant="outline"
        disabled={unavailable || mode.kind === "loading" || preparing}
        onClick={() => void playDevotional({ devotionalId, day: dayKey, index, reading, mode })}
        title={title}
        aria-label={title ?? "Listen"}
        data-listen-mode={mode.kind}
      >
        {preparing ? <Loader2 style={icon} className="animate-spin" /> : <Headphones style={icon} />}
        {preparing ? `Preparing voice… ${Math.round(prep.progress * 100)}%` : "Listen"}
        {!preparing && duration && <span className="font-normal tabular-nums text-muted-foreground">· {duration}</span>}
      </Button>
      {mode.kind === "device" && !preparing && <span className="text-[11px] text-muted-foreground">Device voice: no recording available</span>}
      {unavailable && mode.reason && <span className="text-[11px] text-muted-foreground">{mode.reason}</span>}
      {failed && <span className="text-[11px] text-destructive">Could not read it aloud: {failed}</span>}
    </div>
  );
}

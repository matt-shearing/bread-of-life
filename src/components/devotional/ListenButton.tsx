import { Headphones, Loader2, Pause, Play } from "lucide-react";
import { toggle, useAudioSelector } from "@/audio/controller";
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
  quiet,
  className,
}: {
  devotionalId: string;
  dayKey: string;
  index: number;
  reading: DevotionReading;
  size?: "sm" | "md";
  /** For tight spots (the dashboard): hide the button when there is nothing to play,
   *  and keep the "device voice" note in its tooltip rather than a line under it. */
  quiet?: boolean;
  className?: string;
}) {
  const mode = useListenMode(dayKey, reading);
  const prep = usePrepareState();
  const { cur, playing, loading, finished } = useAudioSelector((s) => ({
    cur: s.queue[s.index]?.devotional,
    playing: s.playing,
    loading: s.loading,
    // Loaded and not yet finished: this button becomes pause/resume. Once it has played to
    // the end, it goes back to "Listen" so a tap starts it again from the top. Worked out
    // here so the button does not re-render on every time update.
    finished: !s.playing && s.duration > 0 && s.currentTime >= s.duration - 0.5,
  }));
  const slot = slotOf(reading);
  if (devotionalId !== SPOKEN_DEVOTIONAL_ID || !slot) return null;

  const id = `${slot}/${dayKey}`;
  const isThis = !!cur && cur.devotionalId === devotionalId && cur.day === dayKey && cur.index === index && !finished;
  const preparing = prep.id === id;
  const failed = prep.error?.id === id ? prep.error.message : null;
  const duration = formatListenDuration(mode);
  
  if (isThis) {
    return (
      <Button size={size} variant="secondary" onClick={toggle} className={className} aria-label={playing ? "Pause the reading" : "Resume the reading"}>
        {loading ? <Loader2 size={15} className="animate-spin" /> : playing ? <Pause size={15} /> : <Play size={15} />}
        {playing ? "Pause" : "Resume"}
      </Button>
    );
  }

  const unavailable = mode.kind === "unavailable";
  if (quiet && (unavailable || mode.kind === "loading") && !preparing) return null;
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
        {preparing ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />}
        {preparing ? `Preparing voice… ${Math.round(prep.progress * 100)}%` : "Listen"}
        {!preparing && duration && <span className="font-normal tabular-nums text-muted-foreground">· {duration}</span>}
      </Button>
      {mode.kind === "device" && !preparing && !quiet && <span className="text-[11px] text-muted-foreground">Device voice: no recording available</span>}
      {unavailable && mode.reason && <span className="text-[11px] text-muted-foreground">{mode.reason}</span>}
      {failed && <span className="text-[11px] text-destructive">Could not read it aloud: {failed}</span>}
    </div>
  );
}

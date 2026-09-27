import { Headphones, Loader2, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useAudioSelector, toggle, next, prev, stop, seekTo } from "@/audio/controller";
import { formatClock as fmt } from "@/lib/day";
import { useOpenNowPlaying } from "./NowPlaying";


/**
 * A small, persistent audio player bar shown across the app while narration plays —
 * survives navigation (the audio lives in the controller, not React). It reflects and
 * drives the same playback the OS media controls do.
 */
export function MiniPlayer() {
  const { track, multi, position, playing, currentTime, duration, loading } = useAudioSelector((s) => ({
    track: s.queue[s.index],
    multi: s.queue.length > 1,
    position: `${s.index + 1}/${s.queue.length}`,
    playing: s.playing,
    // Whole seconds: the bar and the clock move once a second, not on every update.
    currentTime: Math.floor(s.currentTime),
    duration: s.duration,
    loading: s.loading,
  }));
  const openNowPlaying = useOpenNowPlaying();

  if (!track) return null;

  const pct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="shrink-0 border-t border-border bg-card/95 backdrop-blur">
      {/* seek bar */}
      <div
        className="group h-1.5 w-full cursor-pointer bg-muted"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (duration) seekTo(((e.clientX - r.left) / r.width) * duration);
        }}
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2">
        <button
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          onClick={openNowPlaying}
          aria-label={`Now playing: ${track.title}. Open the player`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary-600">
            {loading ? (
              <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
            ) : (
              <Headphones style={{ width: 16, height: 16 }} />
            )}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{track.title}</span>
              {multi && <span className="shrink-0 text-xs text-muted-foreground">{position}</span>}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {track.subtitle} · {fmt(currentTime)} / {fmt(duration)}
            </span>
          </span>
        </button>

        {multi && (
          <button onClick={prev} aria-label="Previous" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent">
            <SkipBack style={{ width: 18, height: 18 }} />
          </button>
        )}
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
        >
          {playing ? <Pause style={{ width: 18, height: 18 }} /> : <Play style={{ width: 18, height: 18 }} />}
        </button>
        {multi && (
          <button onClick={next} aria-label="Next" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent">
            <SkipForward style={{ width: 18, height: 18 }} />
          </button>
        )}
        <button onClick={stop} aria-label="Close player" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent">
          <X style={{ width: 17, height: 17 }} />
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Headphones, Pause, Play } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Compact chapter-audio player. BSB ships narration links per chapter
 *  (david / hays / souer) — streamed from the HelloAO audio CDN. */
export function AudioPlayer({ audio }: { audio?: Record<string, string> }) {
  const narrators = audio ? Object.keys(audio) : [];
  const [narrator, setNarrator] = useState(narrators[0] ?? "");
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLAudioElement>(null);

  // Reset when the chapter (audio set) changes.
  useEffect(() => {
    setPlaying(false);
    if (narrators.length && !narrators.includes(narrator)) setNarrator(narrators[0]);
    ref.current?.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio]);

  if (!audio || narrators.length === 0) return null;
  const src = audio[narrator];

  function toggle() {
    const el = ref.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }

  return (
    <div className="flex items-center gap-1">
      <audio ref={ref} src={src} onEnded={() => setPlaying(false)} preload="none" />
      <Tooltip label={playing ? "Pause narration" : "Listen to this chapter"}>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Play chapter audio">
          {playing ? <Pause style={{ width: 18, height: 18 }} /> : <Headphones style={{ width: 18, height: 18 }} />}
        </Button>
      </Tooltip>
      {playing && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="rounded px-1.5 py-0.5 text-xs capitalize text-muted-foreground hover:bg-accent">
              {narrator}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-32 p-1">
            {narrators.map((n) => (
              <button
                key={n}
                onClick={() => {
                  setNarrator(n);
                  setPlaying(false);
                  ref.current?.pause();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm capitalize hover:bg-accent",
                  n === narrator && "bg-accent",
                )}
              >
                {n === narrator && <Play style={{ width: 12, height: 12 }} className="text-primary-600" />}
                {n}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

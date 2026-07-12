import { useEffect, useState } from "react";
import { Headphones, Pause, Play } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui";
import { useUI } from "@/store/ui";
import { useAudio, playQueue, toggle, isCurrentChapter } from "@/audio/controller";
import { trackFromAudio, buildContinuousQueue } from "@/audio/queue";
import { recordProgress } from "@/db/repos";
import { cn } from "@/lib/cn";

/** Compact chapter-audio button in the reader. Playback runs through the app-wide audio
 *  controller, so it appears in the mini-player + OS media controls and keeps going as you
 *  navigate. Starting narration (BSB david/hays/souer) queues the whole rest of the Bible so
 *  it rolls chapter→book→book continuously in the background. Missler audio is per-chapter. */
export function AudioPlayer({ audio }: { audio?: Record<string, string> }) {
  const { ho, chapter, translation } = useUI();
  const { playing } = useAudio();
  const narrators = audio ? Object.keys(audio) : [];
  const [narrator, setNarrator] = useState(narrators[0] ?? "");

  useEffect(() => {
    if (narrators.length && !narrators.includes(narrator)) setNarrator(narrators[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio]);

  if (!audio || narrators.length === 0) return null;

  const isThis = isCurrentChapter(ho, chapter);
  const showPause = isThis && playing;

  async function start(label: string) {
    const url = audio![label];
    if (!url) return;
    // Missler chapter audio = local per-chapter files (not templatable) — play just this one.
    if (label.toLowerCase().startsWith("missler")) {
      const t = trackFromAudio(ho, chapter, audio!, label, translation);
      if (t) playQueue([t]);
      return;
    }
    // Narration: queue this chapter onward through the whole Bible; keep reading progress
    // in step as it advances (marks fire live in-app, or batch when you reopen the app).
    const q = await buildContinuousQueue(ho, chapter, url, label, translation);
    if (q.length) {
      playQueue(q, { startIndex: 0, onComplete: (t) => void recordProgress(t.ho, t.chapter).catch(() => {}) });
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Tooltip label={showPause ? "Pause narration" : "Listen to this chapter"}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => (isThis ? toggle() : void start(narrator))}
          aria-label="Play chapter audio"
        >
          {showPause ? <Pause style={{ width: 18, height: 18 }} /> : <Headphones style={{ width: 18, height: 18 }} />}
        </Button>
      </Tooltip>
      {narrators.length > 1 && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="rounded px-1.5 py-0.5 text-xs capitalize text-muted-foreground hover:bg-accent">
              {narrator}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-36 p-1">
            {narrators.map((n) => (
              <button
                key={n}
                onClick={() => {
                  setNarrator(n);
                  void start(n);
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

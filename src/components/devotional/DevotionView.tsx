import { useLiveQuery } from "dexie-react-hooks";
import { BookHeart, BookOpen, Check, Sunrise, Sunset } from "lucide-react";
import { db } from "@/db";
import { setDevotionDone } from "@/db/repos";
import type { Devotional, DevotionDay, DevotionReading } from "@/data/devotional";
import { Button, Tabs } from "@/components/ui";
import { ListenButton } from "./ListenButton";
import { cn } from "@/lib/cn";
import { devotionDoneId } from "@/lib/devotionDone";

function labelIcon(label: string) {
  if (label === "Morning") return <Sunrise size={15} />;
  if (label === "Evening") return <Sunset size={15} />;
  return <BookHeart size={15} />;
}

export function DevotionView({
  dev,
  dayKey,
  day,
  index,
  setIndex,
  onOpenVerse,
}: {
  dev: Devotional;
  dayKey: string;
  day: DevotionDay;
  index: number;
  setIndex: (i: number) => void;
  onOpenVerse: (e: DevotionReading) => void;
}) {
  const reading = day.readings[Math.min(index, day.readings.length - 1)];
  const doneId = devotionDoneId(dev.id, dayKey, index);
  const done = useLiveQuery(() => db.devotions.get(doneId), [doneId]);
  const isDone = !!done;

  const body = (
    <>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        {reading.ref ? (
          <button
            onClick={() => onOpenVerse(reading)}
            disabled={!reading.ho}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium [@media(pointer:coarse)]:min-h-11",
              reading.ho
                ? "bg-primary/10 text-primary-700 hover:bg-primary/20 dark:text-primary-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            <BookOpen size={14} />
            {reading.ref}
          </button>
        ) : (
          <span />
        )}
        <ListenButton devotionalId={dev.id} dayKey={dayKey} index={index} reading={reading} />
      </div>

      <div className="space-y-3 font-serif text-[15px] leading-relaxed text-foreground/90">
        {reading.text.split(/\n\n+/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Button variant={isDone ? "secondary" : "success"} onClick={() => setDevotionDone(doneId, !isDone)}>
          <Check size={16} />
          {isDone ? "Completed" : "Mark complete"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {dev.name} · {dev.author} · Public Domain
        </span>
      </div>
    </>
  );

  // Morning and Evening are tabs over the one reading panel.
  if (day.readings.length < 2) return <div>{body}</div>;
  return (
    <Tabs
      label="Reading"
      value={String(index)}
      onValueChange={(v) => setIndex(Number(v))}
      listClassName="mb-4"
      tabs={day.readings.map((r, i) => ({ value: String(i), label: r.label || `Reading ${i + 1}`, icon: labelIcon(r.label) }))}
    >
      {body}
    </Tabs>
  );
}

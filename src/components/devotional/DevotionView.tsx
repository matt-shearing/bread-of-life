import type { ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BookHeart, BookOpen, Check, Sunrise, Sunset } from "lucide-react";
import { db } from "@/db";
import { setDevotionDone } from "@/db/repos";
import type { Devotional, DevotionDay, DevotionReading } from "@/data/devotional";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

function labelIcon(label: string) {
  if (label === "Morning") return <Sunrise style={{ width: 15, height: 15 }} />;
  if (label === "Evening") return <Sunset style={{ width: 15, height: 15 }} />;
  return <BookHeart style={{ width: 15, height: 15 }} />;
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
  const doneId = `${dev.id}:${dayKey}:${index}`;
  const done = useLiveQuery(() => db.devotions.get(doneId), [doneId]);
  const isDone = !!done;

  return (
    <div>
      {day.readings.length > 1 && (
        <div className="mb-4 flex items-center gap-1 rounded-lg bg-muted p-1">
          {day.readings.map((r, i) => (
            <SlotTab key={i} active={i === index} onClick={() => setIndex(i)} icon={labelIcon(r.label)}>
              {r.label || `Reading ${i + 1}`}
            </SlotTab>
          ))}
        </div>
      )}

      {reading.ref && (
        <button
          onClick={() => onOpenVerse(reading)}
          disabled={!reading.ho}
          className={cn(
            "mb-3 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium",
            reading.ho
              ? "bg-primary/10 text-primary-700 hover:bg-primary/20 dark:text-primary-300"
              : "bg-muted text-muted-foreground",
          )}
        >
          <BookOpen style={{ width: 14, height: 14 }} />
          {reading.ref}
        </button>
      )}

      <div className="space-y-3 font-serif text-[15px] leading-relaxed text-foreground/90">
        {reading.text.split(/\n\n+/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Button variant={isDone ? "secondary" : "success"} onClick={() => setDevotionDone(doneId, !isDone)}>
          <Check style={{ width: 16, height: 16 }} />
          {isDone ? "Completed" : "Mark complete"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {dev.name} · {dev.author} · Public Domain
        </span>
      </div>
    </div>
  );
}

function SlotTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

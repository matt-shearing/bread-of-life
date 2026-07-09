import type { ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, Check, Sunrise, Sunset } from "lucide-react";
import { db } from "@/db";
import { setDevotionDone } from "@/db/repos";
import type { DevotionDay, DevotionEntry, Slot } from "@/data/devotional";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

export function DevotionView({
  dayKey,
  day,
  slot,
  setSlot,
  onOpenVerse,
}: {
  dayKey: string;
  day: DevotionDay;
  slot: Slot;
  setSlot: (s: Slot) => void;
  onOpenVerse: (e: DevotionEntry) => void;
}) {
  const entry = day[slot];
  const done = useLiveQuery(() => db.devotions.get(`${dayKey}:${slot}`), [dayKey, slot]);
  const isDone = !!done;

  return (
    <div>
      <div className="mb-4 flex items-center gap-1 rounded-lg bg-muted p-1">
        <SlotTab active={slot === "m"} onClick={() => setSlot("m")} icon={<Sunrise style={{ width: 15, height: 15 }} />}>
          Morning
        </SlotTab>
        <SlotTab active={slot === "e"} onClick={() => setSlot("e")} icon={<Sunset style={{ width: 15, height: 15 }} />}>
          Evening
        </SlotTab>
      </div>

      {entry.ref && (
        <button
          onClick={() => onOpenVerse(entry)}
          disabled={!entry.ho}
          className={cn(
            "mb-3 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium",
            entry.ho ? "bg-primary/10 text-primary-700 hover:bg-primary/20 dark:text-primary-300" : "bg-muted text-muted-foreground",
          )}
        >
          <BookOpen style={{ width: 14, height: 14 }} />
          {entry.ref}
        </button>
      )}

      <div className="space-y-3 font-serif text-[15px] leading-relaxed text-foreground/90">
        {entry.text.split(/\n\n+/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Button variant={isDone ? "secondary" : "success"} onClick={() => setDevotionDone(dayKey, slot, !isDone)}>
          <Check style={{ width: 16, height: 16 }} />
          {isDone ? "Completed" : "Mark complete"}
        </Button>
        <span className="text-xs text-muted-foreground">Spurgeon · Morning &amp; Evening · Public Domain</span>
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

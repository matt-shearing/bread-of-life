import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight, History } from "lucide-react";
import { db } from "@/db";
import { Card } from "@/components/ui";
import { htmlToText } from "@/lib/htmlToText";
import { entryTitle } from "@/components/journal/entryTitle";
import { dayWindows, memoriesOnThisDay, yearsAgoLabel, type Memory } from "@/lib/onThisDay";

/**
 * "On this day" (dashboard): a prayer God answered, or a journal entry written, on this
 * calendar day in an earlier year. Renders nothing when there is no such memory.
 */
export function OnThisDay() {
  const navigate = useNavigate();
  const memories = useLiveQuery(async () => {
    const now = Date.now();
    const [answered, firstEntry] = await Promise.all([
      db.prayers.where("status").equals("answered").toArray(),
      db.journal.orderBy("createdAt").first(),
    ]);
    const earliest = Math.min(now, firstEntry?.createdAt ?? now, ...answered.map((p) => p.answeredAt ?? now));
    const windows = dayWindows(now, new Date(earliest).getFullYear());
    // Only this day in each earlier year, by index: the whole journal is never loaded.
    const journal = (
      await Promise.all(windows.map((w) => db.journal.where("createdAt").between(w.start, w.end, true, false).toArray()))
    ).flat();
    return memoriesOnThisDay(
      now,
      answered,
      // An untitled entry is named by its first words (entryTitle), so don't repeat them below.
      journal.map((j) => ({
        id: j.id,
        title: entryTitle(j),
        text: j.title.trim() ? htmlToText(j.body).slice(0, 240) : "",
        createdAt: j.createdAt,
      })),
    );
  }, []);

  if (!memories?.length) return null;
  const shown = memories.slice(0, 2);
  const more = memories.length - shown.length;
  const open = (m: Memory) => navigate(m.kind === "answered" ? `/prayers?focus=${encodeURIComponent(m.id)}` : `/journal?open=${encodeURIComponent(m.id)}`);

  return (
    <Card className="mb-6 p-5" data-testid="on-this-day">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <History style={{ width: 16, height: 16 }} className="text-primary-600" /> On this day
      </div>
      <div className="space-y-1">
        {shown.map((m) => (
          <button
            key={`${m.kind}:${m.id}`}
            onClick={() => open(m)}
            className="group -mx-2 flex w-[calc(100%+1rem)] items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm text-muted-foreground">
                {yearsAgoLabel(m.yearsAgo)}, {m.kind === "answered" ? "God answered:" : "you wrote:"}
              </div>
              <div className="font-serif text-base font-bold leading-snug">
                {m.title || "A prayer"}
              </div>
              {m.detail && (
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{m.detail}</p>
              )}
            </div>
            <ChevronRight
              style={{ width: 16, height: 16 }}
              className="mt-1 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100"
            />
          </button>
        ))}
      </div>
      {more > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">
          And {more} more from this day in earlier years.
        </div>
      )}
    </Card>
  );
}

import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { NotebookPen } from "lucide-react";
import { db } from "@/db";
import { htmlToText } from "@/lib/htmlToText";
import { entryTitle } from "@/components/journal/entryTitle";
import { Card } from "@/components/ui";

/** The three most recent journal entries; each opens that entry. */
export function RecentJournal() {
  const journal = useLiveQuery(() => db.journal.orderBy("updatedAt").reverse().limit(3).toArray(), [], []);
  return (
    <section className="mt-6" aria-labelledby="recent-journal">
      <div className="mb-3 flex items-center gap-2">
        <NotebookPen size={18} className="text-primary-700 dark:text-primary-400" aria-hidden />
        <h2 id="recent-journal" className="font-semibold">
          Recent journal
        </h2>
        <Link
          to="/journal"
          className="ml-auto rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:py-3"
        >
          View all
        </Link>
      </div>
      {(journal ?? []).length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Nothing yet — highlight a verse and send it to your journal to begin.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(journal ?? []).map((e) => {
            const text = htmlToText(e.body);
            return (
              <Link
                key={e.id}
                to={`/journal?open=${encodeURIComponent(e.id)}`}
                className="block rounded-lg border border-border bg-card p-4 text-card-foreground shadow-card transition-colors hover:border-primary/40"
              >
                <h3 className="font-medium">{entryTitle(e)}</h3>
                {e.title.trim() && text && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{text}</p>}
                <div className="mt-2 text-xs text-muted-foreground">{new Date(e.updatedAt).toLocaleDateString()}</div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

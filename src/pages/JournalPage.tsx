import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link2, NotebookPen, Plus, Search, Trash2, X } from "lucide-react";
import { db, type JournalEntry } from "@/db";
import { addJournalEntry, deleteJournalEntry, updateJournalEntry } from "@/db/repos";
import { parseOsis, refLabel } from "@/lib/osis";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/cn";

function osisToLabel(osis: string) {
  const p = parseOsis(osis);
  return p ? refLabel(p.ho, p.chapter, p.verse) : osis;
}

export function JournalPage() {
  const [editing, setEditing] = useState<JournalEntry | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const entries = useLiveQuery(() => db.journal.orderBy("updatedAt").reverse().toArray(), [], []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries ?? []) for (const t of e.tags) set.add(t);
    return [...set].sort();
  }, [entries]);

  const q = query.trim().toLowerCase();
  const filtered = (entries ?? []).filter((e) => {
    if (tag && !e.tags.includes(tag)) return false;
    if (!q) return true;
    return (
      e.title.toLowerCase().includes(q) ||
      e.body.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q))
    );
  });
  const hasEntries = (entries ?? []).length > 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div>
            <h1 className="font-serif text-3xl font-bold">Journal</h1>
            <p className="text-sm text-muted-foreground">Reflections, notes, and what God is teaching you.</p>
          </div>
          <Button className="ml-auto" onClick={() => setEditing("new")}>
            <Plus style={{ width: 16, height: 16 }} /> New entry
          </Button>
        </div>

        {!hasEntries ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <NotebookPen style={{ width: 32, height: 32 }} className="text-primary-500" />
            <p className="text-muted-foreground">
              Your journal is empty. Write a reflection, or capture a verse from the Bible reader.
            </p>
            <Button onClick={() => setEditing("new")}>
              <Plus style={{ width: 16, height: 16 }} /> New entry
            </Button>
          </Card>
        ) : (
          <>
            <div className="mb-4 space-y-3">
              <div className="relative">
                <Search
                  style={{ width: 16, height: 16 }}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your journal…"
                  className="pl-9"
                />
              </div>
              {allTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {allTags.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTag(tag === t ? null : t)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs",
                        tag === t
                          ? "border-primary bg-primary/10 text-primary-700 dark:text-primary-300"
                          : "border-border text-muted-foreground hover:bg-accent",
                      )}
                    >
                      #{t}
                    </button>
                  ))}
                  {tag && (
                    <button
                      onClick={() => setTag(null)}
                      className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
                    >
                      <X style={{ width: 12, height: 12 }} /> clear
                    </button>
                  )}
                </div>
              )}
            </div>
            {filtered.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                No entries match your search.
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filtered.map((e) => (
              <Card key={e.id} className="group cursor-pointer p-4 hover:border-primary/40" onClick={() => setEditing(e)}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{e.title}</h3>
                  <button
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      deleteJournalEntry(e.id);
                    }}
                    aria-label="Delete entry"
                  >
                    <Trash2 style={{ width: 15, height: 15 }} className="text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
                {e.body && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{e.body}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {e.linkedOsis.map((o) => (
                    <Badge key={o} className="gap-1 border-primary/30 text-primary-700 dark:text-primary-300">
                      <Link2 style={{ width: 11, height: 11 }} />
                      {osisToLabel(o)}
                    </Badge>
                  ))}
                  {e.tags.map((t) => (
                    <Badge key={t} className="text-muted-foreground">
                      #{t}
                    </Badge>
                  ))}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(e.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {editing && <EntryDialog entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EntryDialog({ entry, onClose }: { entry: JournalEntry | "new"; onClose: () => void }) {
  const isNew = entry === "new";
  const [title, setTitle] = useState(isNew ? "" : entry.title);
  const [body, setBody] = useState(isNew ? "" : entry.body);
  const [tags, setTags] = useState(isNew ? "" : entry.tags.join(", "));

  async function save() {
    const tagList = tags
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    if (isNew) {
      await addJournalEntry({ title, body, tags: tagList });
    } else {
      await updateJournalEntry(entry.id, { title: title.trim() || "Untitled entry", body, tags: tagList });
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{isNew ? "New journal entry" : "Edit entry"}</DialogTitle>
        <Input autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder="Write freely…" value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
        <Input placeholder="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
        {!isNew && entry.linkedOsis.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {entry.linkedOsis.map((o) => (
              <Badge key={o} className="border-primary/30 text-primary-700 dark:text-primary-300">
                {osisToLabel(o)}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save entry</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

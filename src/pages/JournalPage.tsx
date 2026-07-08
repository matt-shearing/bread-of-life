import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link2, NotebookPen, Plus, Trash2 } from "lucide-react";
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

function osisToLabel(osis: string) {
  const p = parseOsis(osis);
  return p ? refLabel(p.ho, p.chapter, p.verse) : osis;
}

export function JournalPage() {
  const [editing, setEditing] = useState<JournalEntry | "new" | null>(null);
  const entries = useLiveQuery(() => db.journal.orderBy("updatedAt").reverse().toArray(), [], []);

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

        {(entries ?? []).length === 0 ? (
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
          <div className="grid grid-cols-2 gap-3">
            {(entries ?? []).map((e) => (
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

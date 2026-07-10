import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, HandHeart, Link2, NotebookPen, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { db, type JournalEntry, type Prayer } from "@/db";
import {
  addJournalEntry,
  deleteJournalEntry,
  linkJournalPrayer,
  unlinkJournalPrayer,
  updateJournalEntry,
} from "@/db/repos";
import { parseOsis, refLabel } from "@/lib/osis";
import { useUI } from "@/store/ui";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
} from "@/components/ui";
import { RichEditor, htmlToText } from "@/components/journal/RichEditor";
import { VersePicker } from "@/components/bible/VersePicker";
import { cn } from "@/lib/cn";

function osisToLabel(osis: string) {
  const p = parseOsis(osis);
  return p ? refLabel(p.ho, p.chapter, p.verse) : osis;
}

type DialogState = { id: string | null; mode: "read" | "edit" };

export function JournalPage() {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const entries = useLiveQuery(() => db.journal.orderBy("updatedAt").reverse().toArray(), [], []);

  // Deep-link: /journal?open=<id> opens that entry's read view (used by
  // cross-references from prayers and the Bible study rail).
  useEffect(() => {
    const open = params.get("open");
    if (open) {
      setDialog({ id: open, mode: "read" });
      params.delete("open");
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

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
      htmlToText(e.body).toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q))
    );
  });
  const hasEntries = (entries ?? []).length > 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6 flex items-center gap-3">
          <div>
            <h1 className="font-serif text-3xl font-bold">Journal</h1>
            <p className="text-sm text-muted-foreground">Reflections, notes, and what God is teaching you.</p>
          </div>
          <Button className="ml-auto" onClick={() => setDialog({ id: null, mode: "edit" })}>
            <Plus style={{ width: 16, height: 16 }} /> New entry
          </Button>
        </div>

        {!hasEntries ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <NotebookPen style={{ width: 32, height: 32 }} className="text-primary-500" />
            <p className="text-muted-foreground">
              Your journal is empty. Write a reflection, or capture a verse from the Bible reader.
            </p>
            <Button onClick={() => setDialog({ id: null, mode: "edit" })}>
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {filtered.map((e) => (
                  <Card
                    key={e.id}
                    className="group cursor-pointer p-4 hover:border-primary/40"
                    onClick={() => setDialog({ id: e.id, mode: "read" })}
                  >
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
                    {htmlToText(e.body) && (
                      <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{htmlToText(e.body)}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {e.linkedOsis.map((o) => (
                        <Badge key={o} className="gap-1 border-primary/30 text-primary-700 dark:text-primary-300">
                          <Link2 style={{ width: 11, height: 11 }} />
                          {osisToLabel(o)}
                        </Badge>
                      ))}
                      {(e.linkedPrayerIds?.length ?? 0) > 0 && (
                        <Badge className="gap-1 border-rose-300 text-rose-600">
                          <HandHeart style={{ width: 11, height: 11 }} />
                          {e.linkedPrayerIds!.length}
                        </Badge>
                      )}
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

      {dialog && (
        <EntryDialog
          id={dialog.id}
          initialMode={dialog.mode}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------- entry dialog -------------------------------- */

function EntryDialog({
  id,
  initialMode,
  onClose,
}: {
  id: string | null;
  initialMode: "read" | "edit";
  onClose: () => void;
}) {
  const [curId, setCurId] = useState(id);
  const [mode, setMode] = useState(initialMode);
  const entry = useLiveQuery(() => (curId ? db.journal.get(curId) : undefined), [curId]);

  // Existing entry that vanished (e.g. deleted elsewhere) → close.
  useEffect(() => {
    if (curId && entry === null) onClose();
  }, [curId, entry, onClose]);

  if (mode === "edit") {
    // For an existing entry, wait until it's loaded before mounting the editor
    // so the fields initialise from real data.
    if (curId && entry === undefined) return null;
    return (
      <EntryEditor
        key={curId ?? "new"}
        entry={entry ?? null}
        onSaved={(savedId) => {
          setCurId(savedId);
          setMode("read");
        }}
        onCancel={() => {
          if (curId) setMode("read");
          else onClose();
        }}
      />
    );
  }

  if (!entry) return null;
  return <EntryReadView entry={entry} onEdit={() => setMode("edit")} onClose={onClose} />;
}

/* --------------------------------- read view ---------------------------------- */

function EntryReadView({
  entry,
  onEdit,
  onClose,
}: {
  entry: JournalEntry;
  onEdit: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { goTo, selectVerse } = useUI();
  const [linking, setLinking] = useState(false);

  const linkedPrayers = useLiveQuery(
    () =>
      entry.linkedPrayerIds?.length
        ? db.prayers.where("id").anyOf(entry.linkedPrayerIds).toArray()
        : Promise.resolve([] as Prayer[]),
    [entry.linkedPrayerIds?.join(",")],
    [] as Prayer[],
  );

  function openPassage(osis: string) {
    const p = parseOsis(osis);
    if (!p) return;
    goTo(p.ho, p.chapter);
    if (p.verse) selectVerse(p.verse);
    onClose();
    navigate("/bible");
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{entry.title}</DialogTitle>
        <div className="text-xs text-muted-foreground">
          {new Date(entry.updatedAt).toLocaleString()}
        </div>

        {htmlToText(entry.body) ? (
          <div
            className="prose-journal max-h-[45vh] overflow-y-auto text-sm"
            dangerouslySetInnerHTML={{ __html: entry.body }}
          />
        ) : (
          <p className="text-sm italic text-muted-foreground">No text yet — tap Edit to write.</p>
        )}

        {entry.linkedOsis.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <BookOpen style={{ width: 13, height: 13 }} /> Linked verses
            </div>
            <div className="flex flex-wrap gap-1.5">
              {entry.linkedOsis.map((o) => (
                <button
                  key={o}
                  onClick={() => openPassage(o)}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs text-primary-700 hover:bg-primary/10 dark:text-primary-300"
                >
                  <Link2 style={{ width: 11, height: 11 }} />
                  {osisToLabel(o)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <HandHeart style={{ width: 13, height: 13 }} /> Linked prayers
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(linkedPrayers ?? []).map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onClose();
                  navigate(`/prayers?focus=${p.id}`);
                }}
                className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-xs text-rose-600 hover:bg-rose-100 dark:bg-rose-950/30"
              >
                <HandHeart style={{ width: 11, height: 11 }} />
                {p.title}
              </button>
            ))}
            <button
              onClick={() => setLinking(true)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <Plus style={{ width: 11, height: 11 }} /> Link a prayer
            </button>
          </div>
        </div>

        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {entry.tags.map((t) => (
              <Badge key={t} className="text-muted-foreground">
                #{t}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onEdit}>
            <Pencil style={{ width: 15, height: 15 }} /> Edit
          </Button>
        </div>
      </DialogContent>

      {linking && (
        <PrayerLinkPicker
          journalId={entry.id}
          linkedIds={entry.linkedPrayerIds ?? []}
          onClose={() => setLinking(false)}
        />
      )}
    </Dialog>
  );
}

/* ----------------------------------- editor ----------------------------------- */

function EntryEditor({
  entry,
  onSaved,
  onCancel,
}: {
  entry: JournalEntry | null;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const isNew = entry === null;
  const [title, setTitle] = useState(entry?.title ?? "");
  const [body, setBody] = useState(entry?.body ?? "");
  const [tags, setTags] = useState(entry ? entry.tags.join(", ") : "");
  const [linkedOsis, setLinkedOsis] = useState<string[]>(entry?.linkedOsis ?? []);
  const [picking, setPicking] = useState(false);

  async function save() {
    const tagList = tags
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    if (isNew) {
      const newId = await addJournalEntry({ title, body, tags: tagList, linkedOsis });
      onSaved(newId);
    } else {
      await updateJournalEntry(entry.id, {
        title: title.trim() || "Untitled entry",
        body,
        tags: tagList,
        linkedOsis,
      });
      onSaved(entry.id);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{isNew ? "New journal entry" : "Edit entry"}</DialogTitle>
        <Input autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <RichEditor value={body} onChange={setBody} />
        <Input placeholder="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />

        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Linked verses
            </span>
            <button
              onClick={() => setPicking(true)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-primary-700 hover:bg-accent dark:text-primary-300"
            >
              <BookOpen style={{ width: 12, height: 12 }} /> Tag in the Bible
            </button>
          </div>
          {linkedOsis.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {linkedOsis.map((o) => (
                <button
                  key={o}
                  onClick={() => setLinkedOsis((prev) => prev.filter((x) => x !== o))}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs text-primary-700 hover:bg-primary/10 dark:text-primary-300"
                >
                  {osisToLabel(o)}
                  <X style={{ width: 11, height: 11 }} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={save}>Save entry</Button>
        </div>
      </DialogContent>

      {picking && (
        <VersePicker
          initial={linkedOsis}
          onConfirm={(osis) => {
            setLinkedOsis(osis);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </Dialog>
  );
}

/* ------------------------------ prayer link picker ---------------------------- */

function PrayerLinkPicker({
  journalId,
  linkedIds,
  onClose,
}: {
  journalId: string;
  linkedIds: string[];
  onClose: () => void;
}) {
  const prayers = useLiveQuery(() => db.prayers.orderBy("createdAt").reverse().toArray(), [], []);
  const linked = new Set(linkedIds);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>Link a prayer</DialogTitle>
        {(prayers ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no prayers yet.</p>
        ) : (
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {(prayers ?? []).map((p: Prayer) => {
              const on = linked.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() =>
                    on ? unlinkJournalPrayer(journalId, p.id) : linkJournalPrayer(journalId, p.id)
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border p-2.5 text-left transition-colors",
                    on ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                  )}
                >
                  <HandHeart
                    style={{ width: 15, height: 15 }}
                    className={on ? "text-primary-600" : "text-muted-foreground"}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                  {on && <span className="text-xs text-primary-600">Linked</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

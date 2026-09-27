import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, HandHeart, History, Link2, NotebookPen, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { db, type JournalEntry, type Prayer } from "@/db";
import {
  addJournalEntry,
  deleteJournalEntry,
  linkJournalPrayer,
  restoreJournalEntry,
  unlinkJournalPrayer,
  updateJournalEntry,
} from "@/db/repos";
import { parseOsis, refLabel } from "@/lib/osis";
import { useUI } from "@/store/ui";
import { useOpenRef } from "@/lib/useOpenRef";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
} from "@/components/ui";
import { RichEditor } from "@/components/journal/RichEditor";
import { htmlToText } from "@/lib/htmlToText";
import { VersePicker } from "@/components/bible/VersePicker";
import { cn } from "@/lib/cn";
import { safeJournalHtml } from "@/lib/safeHtml";
import { COARSE_H, showUndoToast, useBackGuard, useConfirm } from "@/components/confirm";
import { clearDraft, loadDraft, onDraftsChanged, saveDraft } from "@/components/journal/drafts";
import { entryTitle } from "@/components/journal/entryTitle";

/** Chips (tags, linked verses/prayers) grow to a 44px touch target on touch screens. */
const CHIP_TOUCH = "[@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-3.5";

/** The unsaved new-entry draft's title (or "" if there is none), live across the page. */
function useNewDraftTitle(): string | null {
  const snap = useSyncExternalStore(onDraftsChanged, () => {
    const d = loadDraft(null);
    return d ? d.title.trim() || htmlToText(d.body).slice(0, 60) || "\u0000" : null;
  });
  return snap === "\u0000" ? "" : snap;
}

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
    } else if (params.get("new")) {
      // /journal?new=1 — "New journal entry" from the Ctrl+K palette.
      setDialog({ id: null, mode: "edit" });
      params.delete("new");
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
  const newDraft = useNewDraftTitle();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6 flex items-center gap-3">
          <div>
            <h1 className="font-serif text-3xl font-bold">Journal</h1>
            <p className="text-sm text-muted-foreground">Reflections, notes, and what God is teaching you.</p>
          </div>
          <Button
            className="ml-auto shrink-0 whitespace-nowrap"
            onClick={() => setDialog({ id: null, mode: "edit" })}
          >
            <Plus style={{ width: 16, height: 16 }} /> New entry
          </Button>
        </div>

        {newDraft !== null && !dialog && (
          <button
            type="button"
            data-testid="journal-draft-hint"
            onClick={() => setDialog({ id: null, mode: "edit" })}
            className="mb-4 flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-left text-sm hover:bg-primary/10"
          >
            <History style={{ width: 16, height: 16 }} className="shrink-0 text-primary-600" />
            <span className="min-w-0 flex-1 truncate">
              You have an unsaved entry{newDraft ? <>: <strong>{newDraft}</strong></> : null}
            </span>
            <span className="shrink-0 font-medium text-primary-700 dark:text-primary-300">Continue →</span>
          </button>
        )}

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
                  type="search"
                  aria-label="Search your journal"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your journal…"
                  className="pl-9"
                />
              </div>
              {allTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
                  {allTags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={tag === t}
                      onClick={() => setTag(tag === t ? null : t)}
                      className={cn(
                        "inline-flex min-h-[28px] items-center rounded-full border px-2.5 py-0.5 text-xs",
                        CHIP_TOUCH,
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
                      type="button"
                      onClick={() => setTag(null)}
                      className={cn(
                        "flex min-h-[28px] items-center gap-0.5 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent",
                        CHIP_TOUCH,
                      )}
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
                    role="button"
                    tabIndex={0}
                    data-testid="journal-card"
                    className="cursor-pointer p-4 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setDialog({ id: e.id, mode: "read" })}
                    onKeyDown={(ev) => {
                      if (ev.target !== ev.currentTarget) return;
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        setDialog({ id: e.id, mode: "read" });
                      }
                    }}
                  >
                    <h3 className={cn("font-semibold", !e.title.trim() && "italic text-muted-foreground")}>
                      {entryTitle(e)}
                    </h3>
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
  // The editor registers its "close, but ask first if there are changes" here so
  // the Android back gesture goes through the same path as Escape and Cancel.
  const editorBack = useRef<(() => boolean) | null>(null);

  // One back guard for the whole dialog (read and edit), so switching modes
  // never races two history entries against each other.
  useBackGuard(true, () => {
    if (mode === "edit" && editorBack.current) return editorBack.current();
    onClose();
    return false;
  });

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
        backRef={editorBack}
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
  const { selectVerse } = useUI();
  const openRef = useOpenRef();
  const [linking, setLinking] = useState(false);
  const { confirm, confirmElement } = useConfirm();

  async function remove() {
    const linkedCount = entry.linkedPrayerIds?.length ?? 0;
    const choice = await confirm({
      title: "Delete this entry?",
      description: `“${entryTitle(entry)}” will be removed from your journal${
        linkedCount ? ` and unlinked from ${linkedCount} prayer${linkedCount === 1 ? "" : "s"}` : ""
      }. You can undo this straight afterwards.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (choice !== "confirm") return;
    const snapshot = (await db.journal.get(entry.id)) ?? entry;
    onClose();
    await deleteJournalEntry(entry.id);
    clearDraft(entry.id);
    showUndoToast({
      message: "Journal entry deleted",
      onUndo: () => restoreJournalEntry(snapshot),
    });
  }

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
    if (p.verse) selectVerse(p.verse);
    onClose();
    openRef(p.ho, p.chapter, p.verse, { path: "/journal", label: "your journal" });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle className={cn(!entry.title.trim() && "italic")}>{entryTitle(entry)}</DialogTitle>
        <div className="text-xs text-muted-foreground">
          {new Date(entry.updatedAt).toLocaleString()}
        </div>

        {htmlToText(entry.body) ? (
          <div
            className="prose-journal max-h-[45vh] overflow-y-auto text-sm"
            dangerouslySetInnerHTML={{ __html: safeJournalHtml(entry.body) }}
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
                  type="button"
                  onClick={() => openPassage(o)}
                  className={cn(
                    "inline-flex min-h-[28px] items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs text-primary-700 hover:bg-primary/10 dark:text-primary-300",
                    CHIP_TOUCH,
                  )}
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
                type="button"
                onClick={() => {
                  onClose();
                  navigate(`/prayers?focus=${p.id}`);
                }}
                className={cn(
                  "inline-flex min-h-[28px] items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-xs text-rose-600 hover:bg-rose-100 dark:bg-rose-950/30",
                  CHIP_TOUCH,
                )}
              >
                <HandHeart style={{ width: 11, height: 11 }} />
                {p.title}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setLinking(true)}
              className={cn(
                "inline-flex min-h-[28px] items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent",
                CHIP_TOUCH,
              )}
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

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            className={cn("mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive", COARSE_H)}
            onClick={() => void remove()}
          >
            <Trash2 style={{ width: 15, height: 15 }} /> Delete
          </Button>
          <Button variant="ghost" className={COARSE_H} onClick={onClose}>
            Close
          </Button>
          <Button className={COARSE_H} onClick={onEdit}>
            <Pencil style={{ width: 15, height: 15 }} /> Edit
          </Button>
        </div>
        {confirmElement}
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

type EditorFields = { title: string; body: string; tags: string; linkedOsis: string[] };

/** Tiptap turns an empty document into "<p></p>"; treat that as no body. */
function sameBody(a: string, b: string) {
  if (a === b) return true;
  const empty = (h: string) => h.replace(/<p>\s*<\/p>/g, "").trim() === "";
  return empty(a) && empty(b);
}

function sameFields(a: EditorFields, b: EditorFields) {
  return (
    a.title === b.title &&
    a.tags === b.tags &&
    sameBody(a.body, b.body) &&
    a.linkedOsis.join("|") === b.linkedOsis.join("|")
  );
}

function EntryEditor({
  entry,
  onSaved,
  onCancel,
  backRef,
}: {
  entry: JournalEntry | null;
  onSaved: (id: string) => void;
  onCancel: () => void;
  backRef: React.MutableRefObject<(() => boolean) | null>;
}) {
  const isNew = entry === null;
  const draftId = entry?.id ?? null;
  // What the entry looked like when the editor opened — "dirty" is measured against this.
  const [initial] = useState<EditorFields>(() => ({
    title: entry?.title ?? "",
    body: entry?.body ?? "",
    tags: entry ? entry.tags.join(", ") : "",
    linkedOsis: entry?.linkedOsis ?? [],
  }));
  // A draft left behind by an Escape, a stray tap, Android back or a closed app.
  const [restored, setRestored] = useState(() => {
    const d = loadDraft(draftId);
    return d && !sameFields(d, initial) ? d : null;
  });
  const start = restored ?? initial;
  const [title, setTitle] = useState(start.title);
  const [body, setBody] = useState(start.body);
  const [tags, setTags] = useState(start.tags);
  const [linkedOsis, setLinkedOsis] = useState<string[]>(start.linkedOsis);
  const [editorKey, setEditorKey] = useState(0);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const { confirm, confirmElement } = useConfirm();
  const titleId = useId();
  const tagsId = useId();

  const current: EditorFields = { title, body, tags, linkedOsis };
  const dirty = !sameFields(current, initial);

  // Autosave: keep the draft in local storage while there are changes.
  const latest = useRef({ current, dirty });
  latest.current = { current, dirty };
  const settled = useRef(false); // saved or discarded — stop writing drafts
  const flush = useCallback(() => {
    if (settled.current) return;
    if (latest.current.dirty) saveDraft(draftId, latest.current.current);
    else clearDraft(draftId);
  }, [draftId]);
  useEffect(() => {
    const t = setTimeout(flush, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, tags, linkedOsis.join("|"), flush]);
  useEffect(() => {
    // Also write immediately if the app is backgrounded or the editor unmounts
    // (a route change, or the dialog torn down by Android back).
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  async function save() {
    if (saving) return;
    setSaving(true);
    const tagList = tags
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    try {
      let savedId: string;
      if (isNew) {
        savedId = await addJournalEntry({ title, body, tags: tagList, linkedOsis });
      } else {
        await updateJournalEntry(entry.id, {
          title: title.trim() || "Untitled entry",
          body,
          tags: tagList,
          linkedOsis,
        });
        savedId = entry.id;
      }
      settled.current = true;
      clearDraft(draftId);
      onSaved(savedId);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    settled.current = true;
    clearDraft(draftId);
    onCancel();
  }

  const confirmOpen = useRef(false);
  async function requestClose() {
    if (!latest.current.dirty) {
      discard();
      return;
    }
    if (confirmOpen.current) return;
    confirmOpen.current = true;
    const choice = await confirm({
      title: "Save your changes?",
      description: "Your writing is kept as a draft on this device until you save or discard it.",
      confirmLabel: "Save",
      extraLabel: "Discard",
      extraDestructive: true,
      cancelLabel: "Keep editing",
    });
    confirmOpen.current = false;
    if (choice === "confirm") await save();
    else if (choice === "extra") discard();
  }

  // Android back: close if clean, otherwise ask (and keep guarding meanwhile).
  backRef.current = () => {
    if (confirmOpen.current) return true;
    const wasDirty = latest.current.dirty;
    void requestClose();
    return wasDirty;
  };
  useEffect(
    () => () => {
      backRef.current = null;
    },
    [backRef],
  );

  function dropRestored() {
    setTitle(initial.title);
    setBody(initial.body);
    setTags(initial.tags);
    setLinkedOsis(initial.linkedOsis);
    setEditorKey((k) => k + 1); // Tiptap only reads `value` on mount
    setRestored(null);
    clearDraft(draftId);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && void requestClose()}>
      <DialogContent className="max-h-[100dvh] max-w-2xl overflow-y-auto" data-testid="journal-editor">
        <DialogTitle>{isNew ? "New journal entry" : "Edit entry"}</DialogTitle>

        {restored && (
          <div
            data-testid="draft-restored"
            className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
          >
            <History style={{ width: 15, height: 15 }} className="shrink-0 text-primary-600" />
            <span className="min-w-0 flex-1">
              Restored your unsaved changes from{" "}
              {new Date(restored.savedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              .
            </span>
            <button
              type="button"
              onClick={dropRestored}
              className="min-h-[32px] rounded px-2 text-xs font-medium text-muted-foreground underline hover:text-foreground [@media(pointer:coarse)]:min-h-[44px]"
            >
              {isNew ? "Start fresh" : "Discard them"}
            </button>
          </div>
        )}

        <div className="grid gap-1.5">
          <label htmlFor={titleId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Title
          </label>
          <Input
            id={titleId}
            autoFocus
            placeholder="Give this entry a title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <RichEditor key={editorKey} value={body} onChange={setBody} label="Journal entry" />
        <div className="grid gap-1.5">
          <label htmlFor={tagsId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tags
          </label>
          <Input
            id={tagsId}
            placeholder="Comma separated, e.g. grace, family"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Linked verses
            </span>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className={cn(
                "inline-flex min-h-[28px] items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-primary-700 hover:bg-accent dark:text-primary-300",
                CHIP_TOUCH,
              )}
            >
              <BookOpen style={{ width: 12, height: 12 }} /> Tag in the Bible
            </button>
          </div>
          {linkedOsis.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {linkedOsis.map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-label={`Remove ${osisToLabel(o)}`}
                  onClick={() => setLinkedOsis((prev) => prev.filter((x) => x !== o))}
                  className={cn(
                    "inline-flex min-h-[28px] items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs text-primary-700 hover:bg-primary/10 dark:text-primary-300",
                    CHIP_TOUCH,
                  )}
                >
                  {osisToLabel(o)}
                  <X style={{ width: 11, height: 11 }} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
              Draft kept on this device
            </span>
          )}
          <Button variant="ghost" className={COARSE_H} onClick={() => void requestClose()}>
            Cancel
          </Button>
          <Button className={COARSE_H} onClick={() => void save()} disabled={saving}>
            Save entry
          </Button>
        </div>
        {confirmElement}
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

/**
 * Unsaved journal drafts, kept in localStorage so an accidental Escape, overlay
 * tap, Android back or app kill never throws away what was typed. One draft per
 * entry (`<id>`) plus one for a brand-new entry (`new`). A draft is removed when
 * the entry is saved or the user explicitly discards it.
 */
export interface JournalDraft {
  title: string;
  body: string;
  tags: string;
  linkedOsis: string[];
  savedAt: number;
}

const PREFIX = "bol.journalDraft.";
export const NEW_DRAFT_KEY = "new";
const EVENT = "bol-journal-draft";

function key(id: string | null) {
  return PREFIX + (id ?? NEW_DRAFT_KEY);
}

export function loadDraft(id: string | null): JournalDraft | null {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<JournalDraft>;
    if (typeof d !== "object" || d === null) return null;
    return {
      title: typeof d.title === "string" ? d.title : "",
      body: typeof d.body === "string" ? d.body : "",
      tags: typeof d.tags === "string" ? d.tags : "",
      linkedOsis: Array.isArray(d.linkedOsis) ? d.linkedOsis.filter((x) => typeof x === "string") : [],
      savedAt: typeof d.savedAt === "number" ? d.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveDraft(id: string | null, draft: Omit<JournalDraft, "savedAt">): void {
  try {
    localStorage.setItem(key(id), JSON.stringify({ ...draft, savedAt: Date.now() }));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage full or blocked — the confirm-on-close still protects the draft */
  }
}

export function clearDraft(id: string | null): void {
  try {
    localStorage.removeItem(key(id));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* ignore */
  }
}

/** Subscribe to draft changes in this tab (for the "continue your draft" hint). */
export function onDraftsChanged(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

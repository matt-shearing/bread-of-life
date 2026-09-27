import type { JournalEntry } from "@/db";
import { htmlToText } from "@/lib/htmlToText";

/**
 * What to call a journal entry. Synced or imported entries can arrive with an
 * empty title, which would leave an empty heading and an unnamed dialog, so fall
 * back to the first words of the entry, then its date.
 */
export function entryTitle(e: Pick<JournalEntry, "title" | "body" | "createdAt">): string {
  const t = e.title.trim();
  if (t) return t;
  const first = htmlToText(e.body);
  if (first) return first.length > 60 ? `${first.slice(0, 57).trimEnd()}…` : first;
  return `Entry from ${new Date(e.createdAt).toLocaleDateString()}`;
}

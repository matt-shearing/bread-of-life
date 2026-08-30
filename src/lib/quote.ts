/**
 * Quoting scripture out of the reader.
 *
 * Two jobs that belong together: reading a native text selection back out of the
 * rendered chapter as *verses*, and formatting verses as a citation somebody can
 * paste into a message and still look up afterwards.
 *
 * The reader renders each verse as `<span data-verse="16">` wrapping a
 * `<span data-verse-text>` that holds nothing but the words — the verse number
 * `<sup>` and the note/memorise icons sit outside it. Intersecting a selection
 * with those inner spans is what keeps "16" and stray glyphs out of a quotation.
 * `Range.toString()` ignores `user-select: none`, so marking the `<sup>` unselectable
 * is not on its own enough.
 */
import { refLabel, refRange } from "./osis";

export interface VerseSelection {
  /** The selected words, split per verse, in reading order. */
  verses: { n: number; text: string }[];
  /** True when the selection covers less than the whole of the verses it touches. */
  partial: boolean;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The current window selection, as verses, or null when there is no usable
 * selection inside `root`.
 */
export function readVerseSelection(root: HTMLElement | null): VerseSelection | null {
  if (!root || typeof window === "undefined") return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const verses: { n: number; text: string }[] = [];
  let partial = false;

  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-verse-text]"))) {
    if (!range.intersectsNode(el)) continue;
    const n = Number(el.parentElement?.dataset.verse);
    if (!Number.isFinite(n)) continue;

    // Intersect the selection with this verse's words. Clamping only when the
    // boundary actually lies inside this element is what makes a selection that
    // spans several verses give each one its own slice: a verse the selection
    // merely passes through keeps all of its text.
    const piece = document.createRange();
    piece.selectNodeContents(el);
    if (el.contains(range.startContainer)) piece.setStart(range.startContainer, range.startOffset);
    if (el.contains(range.endContainer)) piece.setEnd(range.endContainer, range.endOffset);

    // `intersectsNode` counts a selection that merely ends where this verse begins,
    // which clamps to nothing — that verse was never really selected.
    const text = squash(piece.toString());
    if (!text) continue;
    if (text !== squash(el.textContent ?? "")) partial = true;
    verses.push({ n, text });
  }

  return verses.length ? { verses, partial } : null;
}

/** Is anything at all selected right now? Cheap enough to call on every pointer event. */
export function hasLiveSelection(): boolean {
  if (typeof window === "undefined") return false;
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().trim().length > 0;
}

/** Drop the current selection (used when a range or the toolbar takes over). */
export function clearLiveSelection(): void {
  if (typeof window === "undefined") return;
  window.getSelection()?.removeAllRanges();
}

/**
 * One quotation, formatted the way it should land in someone's notes: the words,
 * an em dash, and a reference you can look up.
 *
 *     For God so loved the world… — John 3:16 (BSB)
 *
 * A run of verses keeps one line per verse and collapses to a single range
 * reference, so pasting three verses doesn't paste three citations:
 *
 *     For God so loved the world…
 *     For God did not send His Son…
 *      — John 3:16-17 (BSB)
 */
export function citation(
  ho: string,
  chapter: number,
  verses: { n: number; text: string }[],
  translationShort: string,
): string {
  if (verses.length === 0) return "";
  if (verses.length === 1) {
    return `${verses[0].text} — ${refLabel(ho, chapter, verses[0].n)} (${translationShort})`;
  }
  const body = verses.map((v) => v.text).join("\n");
  const ref = refRange(ho, chapter, verses[0].n, verses[verses.length - 1].n);
  return `${body}\n — ${ref} (${translationShort})`;
}

/** The label a selection tray shows: "John 3:16" or "John 3:16-18". */
export function quoteLabel(ho: string, chapter: number, verses: { n: number }[]): string {
  if (verses.length === 0) return refLabel(ho, chapter);
  if (verses.length === 1) return refLabel(ho, chapter, verses[0].n);
  return refRange(ho, chapter, verses[0].n, verses[verses.length - 1].n);
}

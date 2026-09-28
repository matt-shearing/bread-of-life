/**
 * Guards for the app's single-key keyboard shortcuts (←/→, [ ], /, ?).
 * They must never fire while someone is typing — in an input, a textarea, a select,
 * or the Tiptap journal editor (a contenteditable `.ProseMirror`) — nor underneath
 * an open dialog, popover or menu.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(type);
  }
  return !!el.closest?.('[contenteditable=""], [contenteditable="true"], .ProseMirror');
}

/** Is a dialog, popover, menu or sheet open over the page? */
export function overlayOpen(): boolean {
  // Radix popovers render role="dialog" and menus role="menu"; tooltips are left out
  // on purpose (one is often showing over the chevron you just clicked).
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** "⌘K" on a Mac, "Ctrl K" elsewhere. */
export const MOD_K = isMac ? "⌘K" : "Ctrl K";

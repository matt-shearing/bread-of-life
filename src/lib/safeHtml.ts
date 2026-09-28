import DOMPurify from "dompurify";

/**
 * Journal entries are stored as HTML from the rich-text editor (TipTap StarterKit) and
 * arrive from other devices through the sync server. Rendering that HTML as-is would let
 * a compromised server, or a crafted backup, run script inside the app, which in the
 * desktop and Android builds can reach local files. Only the markup the editor itself
 * produces survives: no scripts, event handlers, styles, iframes, images or forms.
 */
const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "s", "u", "code", "pre", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "hr", "a", "span",
];

export function safeJournalHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "target", "rel", "start"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
  });
}

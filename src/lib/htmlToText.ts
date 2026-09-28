/**
 * Strip HTML to plain text for previews and search.
 *
 * Lives on its own (not beside the Tiptap editor) so callers outside the
 * journal don't pull the ~1 MB editor bundle in with it.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

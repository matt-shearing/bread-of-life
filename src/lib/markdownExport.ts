/**
 * Export the words you have written — journal, prayers, notes and highlights — as
 * plain Markdown, zipped into one file. Unlike a backup (src/lib/backup.ts) this is
 * for reading and keeping elsewhere, not for restoring: it drops into an Obsidian
 * vault as-is.
 *
 * Layout inside the zip:
 *   Bread of Life/Journal/2026-09-27 Title.md   one per entry, YAML front matter
 *   Bread of Life/Prayers.md                    answered first, with dates and answers
 *   Bread of Life/Notes.md                      verse notes and highlights, in Bible order
 *
 * Journal bodies are HTML from the Tiptap editor (older or captured entries may be
 * plain text); htmlToMarkdown converts them without needing a DOM, so it also runs
 * under Node in the tests.
 */
import { zipSync, strToU8 } from "fflate";
import { db, type Highlight, type JournalEntry, type Note, type Prayer } from "@/db";
import { localDayKey } from "@/lib/day";
import { bookByHo, parseOsis, refLabel } from "@/lib/osis";

/* ------------------------------ HTML → Markdown ------------------------------ */

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: HNode[];
}
type HNode = El | string;

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "wbr"]);
const BLOCK = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "hr", "div", "section", "article", "table",
]);

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** A forgiving tag-soup parser: enough for the HTML Tiptap writes, and safe on the rest. */
function parseHtml(html: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+|<)/g;
  for (const m of html.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) {
      top.children.push(decodeEntities(m[4]));
      continue;
    }
    if (!m[2]) continue; // comment
    const tag = m[2].toLowerCase();
    if (m[1]) {
      // close: pop back to the matching open tag, if there is one
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const el: El = { tag, attrs: parseAttrs(m[3]), children: [] };
    top.children.push(el);
    if (!VOID.has(tag) && !m[3].trim().endsWith("/")) stack.push(el);
  }
  return root;
}

/** Backslash-escape what would otherwise turn into Markdown formatting. */
function escapeText(s: string): string {
  return s.replace(/([\\`*_[\]])/g, "\\$1");
}
/** Escape block syntax a line of prose might accidentally start with. */
function escapeLineStart(s: string): string {
  return s.replace(/^(\s*)(#{1,6}\s|>|[-+]\s|\d+[.)]\s)/gm, (_m, sp: string, mark: string) => {
    if (/^\d/.test(mark)) return sp + mark.replace(/([.)])/, "\\$1");
    return `${sp}\\${mark}`;
  });
}

/** Wrap in a mark (`**`), keeping any edge spaces outside it so the mark still parses. */
function wrap(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

function textOf(n: HNode): string {
  return typeof n === "string" ? n : n.children.map(textOf).join("");
}

function inline(nodes: HNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") {
      out += escapeText(n.replace(/\s+/g, " "));
      continue;
    }
    const inner = () => inline(n.children);
    switch (n.tag) {
      case "strong":
      case "b":
        out += wrap(inner(), "**");
        break;
      case "em":
      case "i":
        out += wrap(inner(), "*");
        break;
      case "s":
      case "del":
      case "strike":
        out += wrap(inner(), "~~");
        break;
      case "code": {
        const t = textOf(n);
        const fence = t.includes("`") ? "``" : "`";
        out += t ? `${fence}${t}${fence}` : "";
        break;
      }
      case "a": {
        const text = inner();
        const href = n.attrs.href ?? "";
        out += href ? `[${text || href}](${href.replace(/[()\s]/g, (c) => encodeURIComponent(c))})` : text;
        break;
      }
      case "br":
        out += "\\\n";
        break;
      case "img":
        out += n.attrs.alt ? escapeText(n.attrs.alt) : "";
        break;
      default:
        out += inner(); // u, span, mark, sub/sup: keep the words
    }
  }
  return out;
}

function prefixLines(s: string, first: string, rest: string): string {
  return s
    .split("\n")
    .map((l, i) => (i === 0 ? first : l ? rest : rest.trimEnd()) + l)
    .join("\n");
}

/** Render a run of sibling nodes as Markdown blocks, grouping loose inline nodes into paragraphs. */
function blocks(nodes: HNode[]): string[] {
  const out: string[] = [];
  let run: HNode[] = [];
  const flush = () => {
    const text = inline(run).replace(/[ \t]+$/gm, "").trim();
    if (text) out.push(escapeLineStart(text));
    run = [];
  };
  for (const n of nodes) {
    if (typeof n === "string" || !BLOCK.has(n.tag)) {
      run.push(n);
      continue;
    }
    flush();
    const b = block(n);
    if (b) out.push(b);
  }
  flush();
  return out;
}

function block(el: El): string {
  switch (el.tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = inline(el.children).replace(/\\\n/g, " ").trim();
      return text ? `${"#".repeat(Number(el.tag[1]))} ${text}` : "";
    }
    case "p":
      return blocks(el.children).join("\n\n");
    case "blockquote": {
      const inner = blocks(el.children).join("\n\n");
      return inner ? prefixLines(inner, "> ", "> ") : "";
    }
    case "ul":
    case "ol": {
      const ordered = el.tag === "ol";
      let n = Number(el.attrs.start) || 1;
      const lis = el.children.filter((c): c is El => typeof c !== "string" && c.tag === "li");
      const rendered = lis.map((c) => blocks(c.children));
      // "Tight" (no blank lines) unless an item holds more than one paragraph; a nested
      // list doesn't count as a paragraph.
      const isList = (p: string) => /^([-*]|\d+\.) /.test(p);
      const loose = rendered.some((parts) => parts.filter((p) => !isList(p)).length > 1);
      const items = rendered.map((parts) => {
        const marker = ordered ? `${n++}. ` : "- ";
        return prefixLines(parts.join(loose ? "\n\n" : "\n"), marker, " ".repeat(marker.length));
      });
      return items.join(loose ? "\n\n" : "\n");
    }
    case "pre": {
      const code = textOf(el).replace(/\n$/, "");
      const lang = /language-([\w-]+)/.exec(
        (typeof el.children[0] === "object" && el.children[0].attrs.class) || "",
      )?.[1];
      const fence = code.includes("```") ? "````" : "```";
      return `${fence}${lang ?? ""}\n${code}\n${fence}`;
    }
    case "hr":
      return "---";
    case "li":
      return blocks(el.children).join("\n\n");
    default:
      return blocks(el.children).join("\n\n");
  }
}

/**
 * Tiptap HTML (or plain text) → Markdown. Headings, bold/italic/strike, inline code,
 * links, bullet and numbered lists (nested), blockquotes, code blocks, rules and hard
 * breaks are carried over; anything else keeps its words.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  if (!/<[a-zA-Z/!]/.test(html)) {
    // Plain text: keep the writer's paragraphs and line breaks as they typed them.
    return html
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/)
      .map((p) => escapeLineStart(escapeText(p.trim())).replace(/\n/g, "\\\n"))
      .filter(Boolean)
      .join("\n\n");
  }
  return blocks(parseHtml(html).children).join("\n\n").trim();
}

/* ------------------------------- file building ------------------------------- */

/** Local "YYYY-MM-DD HH:mm" — readable, and a date Obsidian's properties accept (with T). */
function localStamp(ts: number | null | undefined, sep = " "): string {
  if (!ts) return "";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${localDayKey(ts)}${sep}${hh}:${mm}`;
}

const yamlStr = (s: string) => JSON.stringify(s);
const yamlList = (items: string[]) => (items.length ? `\n${items.map((i) => `  - ${yamlStr(i)}`).join("\n")}` : " []");

function verseLabel(osis: string): string {
  const p = parseOsis(osis);
  return p ? refLabel(p.ho, p.chapter, p.verse) : osis;
}

/** Characters no file system (or Obsidian link) is happy with. */
function safeFileName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, "");
}

/** Journal file names (no extension), unique, keyed by entry id. */
function journalNames(entries: JournalEntry[]): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const e of [...entries].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    const base = `${localDayKey(e.createdAt)} ${safeFileName(e.title) || "Untitled"}`;
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})`;
    used.add(name.toLowerCase());
    names.set(e.id, name);
  }
  return names;
}

export function journalMarkdown(e: JournalEntry, prayerTitles: Map<string, string>): string {
  const prayers = (e.linkedPrayerIds ?? []).map((id) => prayerTitles.get(id)).filter((t): t is string => !!t);
  const fm = [
    "---",
    `title: ${yamlStr(e.title || "Untitled")}`,
    `created: ${localStamp(e.createdAt, "T")}`,
    `updated: ${localStamp(e.updatedAt ?? e.createdAt, "T")}`,
    `tags:${yamlList(e.tags ?? [])}`,
    `verses:${yamlList((e.linkedOsis ?? []).map(verseLabel))}`,
    ...(prayers.length ? [`prayers:${yamlList(prayers)}`] : []),
    ...(e.source ? [`source: ${yamlStr(e.source)}`] : []),
    "---",
  ].join("\n");
  const body = htmlToMarkdown(e.body);
  return `${fm}\n\n# ${escapeText(e.title || "Untitled")}\n\n${body ? `${body}\n` : ""}`;
}

const PRAYER_SECTIONS: { status: Prayer["status"]; heading: string }[] = [
  { status: "answered", heading: "Answered" },
  { status: "active", heading: "Still praying" },
  { status: "archived", heading: "Archived" },
];

export function prayersMarkdown(prayers: Prayer[], journalNamesById: Map<string, string>): string {
  const out: string[] = ["# Prayers", ""];
  const answered = prayers.filter((p) => p.status === "answered").length;
  out.push(`${prayers.length} ${prayers.length === 1 ? "prayer" : "prayers"} · ${answered} answered · exported ${localStamp(Date.now())}`, "");
  for (const { status, heading } of PRAYER_SECTIONS) {
    const list = prayers
      .filter((p) => p.status === status)
      .sort((a, b) =>
        status === "answered" ? (b.answeredAt ?? 0) - (a.answeredAt ?? 0) : b.createdAt - a.createdAt,
      );
    if (!list.length) continue;
    out.push(`## ${heading}`, "");
    for (const p of list) {
      out.push(`### ${escapeText(p.title || "Untitled prayer")}`, "");
      const meta = [`Prayed since ${localDayKey(p.createdAt)}`];
      if (p.category) meta.push(`category: ${p.category}`);
      if (p.prayedCount) meta.push(`prayed ${p.prayedCount} ${p.prayedCount === 1 ? "time" : "times"}`);
      out.push(`*${meta.join(" · ")}*`, "");
      if (p.body?.trim()) out.push(htmlToMarkdown(p.body), "");
      if (p.status === "answered") {
        const when = p.answeredAt ? `Answered ${localDayKey(p.answeredAt)}` : "Answered";
        out.push(`> **${when}**`);
        if (p.answerNote?.trim()) out.push(">", prefixLines(htmlToMarkdown(p.answerNote), "> ", "> "));
        out.push("");
      }
      const verses = (p.linkedOsis ?? []).map(verseLabel);
      if (verses.length) out.push(`Verses: ${verses.join(", ")}`, "");
      const links = (p.linkedJournalIds ?? []).map((id) => journalNamesById.get(id)).filter(Boolean);
      if (links.length) out.push(`Journal: ${links.map((n) => `[[Journal/${n}|${n}]]`).join(", ")}`, "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function notesMarkdown(notes: Note[], highlights: Highlight[]): string {
  type Item = { bbcccvvv: number; osis: string; note?: Note; hl?: Highlight };
  const byOsis = new Map<string, Item>();
  for (const n of notes) byOsis.set(n.osis, { bbcccvvv: n.bbcccvvv, osis: n.osis, note: n });
  for (const h of highlights) {
    const it = byOsis.get(h.osis) ?? { bbcccvvv: h.bbcccvvv, osis: h.osis };
    it.hl = h;
    byOsis.set(h.osis, it);
  }
  const items = [...byOsis.values()].sort((a, b) => a.bbcccvvv - b.bbcccvvv);
  const out: string[] = ["# Notes and highlights", ""];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  out.push(`${plural(notes.length, "note", "notes")} · ${plural(highlights.length, "highlight", "highlights")}, in Bible order`, "");
  let book = "";
  for (const it of items) {
    const p = parseOsis(it.osis);
    const thisBook = (p && bookByHo(p.ho)?.name) || it.osis.split(".")[0];
    if (thisBook !== book) {
      book = thisBook;
      out.push(`## ${book}`, "");
    }
    out.push(`### ${verseLabel(it.osis)}`, "");
    if (it.hl) out.push(`*Highlighted ${it.hl.color}*`, "");
    if (it.note?.body?.trim()) out.push(htmlToMarkdown(it.note.body), "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export interface MarkdownExportData {
  journal: JournalEntry[];
  prayers: Prayer[];
  notes: Note[];
  highlights: Highlight[];
}

/** Every file in the export, path → Markdown text. Pure, for the tests. */
export function buildMarkdownFiles(data: MarkdownExportData, root = "Bread of Life"): Record<string, string> {
  const names = journalNames(data.journal);
  const prayerTitles = new Map(data.prayers.map((p) => [p.id, p.title]));
  const files: Record<string, string> = {};
  for (const e of data.journal) files[`${root}/Journal/${names.get(e.id)}.md`] = journalMarkdown(e, prayerTitles);
  files[`${root}/Prayers.md`] = prayersMarkdown(data.prayers, names);
  files[`${root}/Notes.md`] = notesMarkdown(data.notes, data.highlights);
  return files;
}

export function markdownExportFileName(now: number = Date.now()): string {
  return `bread-of-life-markdown-${localDayKey(now)}.zip`;
}

/** Read the four tables and zip the Markdown. */
export async function createMarkdownZip(): Promise<{ bytes: Uint8Array; files: number }> {
  const [journal, prayers, notes, highlights] = await Promise.all([
    db.journal.toArray(),
    db.prayers.toArray(),
    db.notes.toArray(),
    db.highlights.toArray(),
  ]);
  const files = buildMarkdownFiles({ journal, prayers, notes, highlights });
  const entries: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) entries[path] = strToU8(text);
  return { bytes: zipSync(entries, { level: 6 }), files: Object.keys(files).length };
}

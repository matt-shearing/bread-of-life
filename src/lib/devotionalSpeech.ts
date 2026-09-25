/**
 * The words a spoken Spurgeon devotional says, as a list of segments with the pause after
 * each. This is a line-for-line port of the normaliser in `scripts/build-devotional-audio.py`
 * (the script that makes the recorded MP3s), so the phone's own voice, used when a
 * recording is not available, reads exactly the same words: the heading ("Morning,
 * September the twenty-fifth."), the key reference spoken out, the key verse, then the
 * body with references, abbreviations, numbered heads and years turned into words.
 *
 * `scripts/test-devotional-speech.mjs` checks the output against the Python script's
 * `--print-text` output. When you change one, change the other and re-run that test.
 *
 * Deliberately free of `@/` imports and TypeScript-only syntax such as enums, so Node can
 * load it directly in the test.
 */

export interface SpeechSegment {
  text: string;
  /** Silence after this segment, in seconds. */
  pause: number;
}

export type DevotionSlot = "morning" | "evening";

export interface DevotionEntry {
  ref?: string | null;
  text: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

/** Pauses in seconds, placed between segments. Same values as the Python script. */
export const PAUSE = {
  heading: 0.7,
  ref: 0.5,
  keyverse: 1.1,
  paragraph: 0.75,
  sentence: 0.32,
  clause: 0.18,
} as const;
const MAX_CHUNK_CHARS = 280;

/* --------------------------------- numbers --------------------------------- */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORD: Record<string, string> = {
  one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth",
};

export function numWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return TENS[t] + (o ? "-" + ONES[o] : "");
  }
  if (n < 1000) {
    const h = Math.floor(n / 100), r = n % 100;
    return ONES[h] + " hundred" + (r ? " and " + numWords(r) : "");
  }
  const th = Math.floor(n / 1000), r = n % 1000;
  return numWords(th) + " thousand" + (r ? (r < 100 ? " and " : " ") + numWords(r) : "");
}

/** Python's str.rpartition. */
function rpartition(s: string, sep: string): [string, string, string] {
  const i = s.lastIndexOf(sep);
  return i < 0 ? ["", "", s] : [s.slice(0, i), sep, s.slice(i + sep.length)];
}

export function ordinalWords(n: number): string {
  const w = numWords(n);
  const [head, sep, lastIn] = w.includes("-") ? rpartition(w, "-") : rpartition(w, " ");
  let last = lastIn;
  if (last in ORD) last = ORD[last];
  else if (last.endsWith("y")) last = last.slice(0, -1) + "ieth";
  else last += "th";
  return head + sep + last;
}

function yearWords(n: number): string {
  const hi = Math.floor(n / 100), lo = n % 100;
  if (lo === 0) return numWords(hi) + " hundred";
  return numWords(hi) + " " + (lo < 10 ? "oh " + ONES[lo] : numWords(lo));
}

/* ---------------------------- scripture references ---------------------------- */

const BOOK_ABBR: Record<string, string> = {
  gen: "Genesis", ex: "Exodus", exod: "Exodus", lev: "Leviticus", num: "Numbers",
  deut: "Deuteronomy", jos: "Joshua", josh: "Joshua", judg: "Judges", sam: "Samuel",
  kings: "Kings", king: "Kings", kgs: "Kings", ch: "Chronicles", chron: "Chronicles",
  neh: "Nehemiah", esth: "Esther", ps: "Psalm", psa: "Psalm", prov: "Proverbs",
  eccl: "Ecclesiastes", eccles: "Ecclesiastes", sol: "Solomon", isa: "Isaiah",
  jer: "Jeremiah", lam: "Lamentations", ezek: "Ezekiel", dan: "Daniel", hos: "Hosea",
  mic: "Micah", hab: "Habakkuk", zech: "Zechariah", mal: "Malachi",
  matt: "Matthew", mat: "Matthew", mk: "Mark", lk: "Luke", jn: "John", rom: "Romans",
  cor: "Corinthians", gal: "Galatians", eph: "Ephesians", phil: "Philippians",
  col: "Colossians", thess: "Thessalonians", tim: "Timothy", tit: "Titus",
  philem: "Philemon", heb: "Hebrews", jas: "James", pet: "Peter", rev: "Revelation",
};
const BOOK_NAMES = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
  "Samuel", "Kings", "Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalm", "Psalms",
  "Proverbs", "Ecclesiastes", "Song of Solomon", "Song of Sol", "Isaiah", "Jeremiah",
  "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
  "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke",
  "John", "Acts", "Romans", "Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
  "Thessalonians", "Timothy", "Titus", "Philemon", "Hebrews", "James", "Peter", "Jude",
  "Revelation",
].sort((a, b) => b.length - a.length);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

const BOOK_ALT =
  BOOK_NAMES.map(esc).join("|") + "|" + Object.keys(BOOK_ABBR).map((a) => esc(capitalize(a)) + "\\.").join("|");
const REF_SRC =
  "(?:\\b([123])\\s+)?\\b(" + BOOK_ALT + ")\\.?,?\\s+(\\d+)(?::(\\d+(?:\\s*[-–]\\s*\\d+)?(?:\\s*,\\s*\\d+(?:\\s*[-–]\\s*\\d+)?)*))?" +
  "(?![\\d:])";
const REF_RE = new RegExp(REF_SRC, "g");
const REF_FULL = new RegExp("^(?:" + REF_SRC + ")$");
const PREFIX: Record<string, string> = { "1": "First", "2": "Second", "3": "Third" };

function verseList(spec: string): string {
  const parts = spec.split(",").map((p) => p.trim()).filter(Boolean);
  const words = parts.map((p) => {
    if (/[-–]/.test(p)) {
      const [a, b] = p.split(/\s*[-–]\s*/);
      return `${numWords(parseInt(a, 10))} to ${numWords(parseInt(b, 10))}`;
    }
    return numWords(parseInt(p, 10));
  });
  const plural = parts.length > 1 || parts.some((p) => /[-–]/.test(p));
  const joined = words.length === 1 ? words[0] : words.slice(0, -1).join(", ") + " and " + words[words.length - 1];
  return (plural ? "verses " : "verse ") + joined;
}

function speakRef(prefix: string | undefined, book: string, chapter: string, verses: string | undefined): string {
  let b = book.replace(/\.+$/, "");
  b = BOOK_ABBR[b.toLowerCase()] ?? b;
  if (b === "Sol" || b === "Song of Sol" || b === "Solomon") b = "Song of Solomon";
  const name = (prefix ? PREFIX[prefix] + " " : "") + b;
  const single = b === "Obadiah" || b === "Philemon" || b === "Jude" || (b === "John" && (prefix === "2" || prefix === "3"));
  const ch = parseInt(chapter, 10);
  if (single && verses == null) return `${name}, verse ${numWords(ch)}`;
  const head = b === "Psalm" || b === "Psalms" ? `Psalm ${numWords(ch)}` : `${name} chapter ${numWords(ch)}`;
  return verses == null ? head : `${head}, ${verseList(verses)}`;
}

const refSub = (_m: string, prefix?: string, book?: string, chapter?: string, verses?: string) =>
  speakRef(prefix || undefined, book!, chapter!, verses ?? undefined);

/** "Romans 3:26" → "Romans chapter three, verse twenty-six". Unparseable input comes back
 *  normalised rather than throwing: the app must never fail to read a day over its heading. */
export function speakKeyRef(ref: string): string {
  const m = REF_FULL.exec(ref.trim());
  if (!m) return normalise(ref);
  return refSub(m[0], m[1], m[2], m[3], m[4]);
}

/* ------------------------------ normalisation ------------------------------ */

const ABBREV: [RegExp, string][] = [
  [/\bMr\./g, "Mister"], [/\bMrs\./g, "Missus"], [/\bDr\./g, "Doctor"], [/\bSt\./g, "Saint"],
  [/\bviz\.,?/g, "namely,"], [/\betc\./g, "et cetera."], [/\bi\.e\./g, "that is,"],
  [/\be\.g\./g, "for example,"], [/&c\./g, "et cetera."],
];
const LIST_ORD: Record<number, string> = {
  1: "First", 2: "Second", 3: "Third", 4: "Fourth", 5: "Fifth", 6: "Sixth",
  7: "Seventh", 8: "Eighth", 9: "Ninth", 10: "Tenth",
};

/** Rewrite one paragraph for speech. Mirrors `normalise()` in the Python script. */
export function normalise(text: string): string {
  let s = text;
  s = s.replace(/’/g, "'").replace(/‘/g, "'").replace(/“/g, '"').replace(/”/g, '"');
  s = s.replace(/…/g, "...");
  s = s.replace(/,(?=[A-Za-z])/g, ", ");
  s = s.replace(/\s*\[([^\]]+)\]/g, ", $1,");
  s = s.replace(/\s*\((read\s+)?([^()]*\d[^()]*)\)/g, (_m, read: string | undefined, body: string) => ", " + (read || "") + body + ",");
  s = s.replace(/\s*\(([^()]*)\)/g, ", $1,");
  s = s.replace(/Song of Sol\./g, "Song of Solomon");
  s = s.replace(REF_RE, refSub);
  for (const [pat, rep] of ABBREV) s = s.replace(pat, rep);
  s = s.replace(/\bWilliam III\b/g, "William the Third");
  s = s.replace(/\bA B C\b/g, "A, B, C");
  s = s.replace(/\bI AM\b/g, "I Am");
  s = s.replace(/\b(?!I\b)[A-Z]{2,}\b/g, (m) => (m.length > 1 ? capitalize(m) : m));
  s = s.replace(/\bby-and-bye?\b/gi, "by and by");
  s = s.replace(/\bfour-and-twenty\b/g, "four and twenty");
  s = s.replace(/\b(1[0-9]{3})\b/g, (_m, y: string) => yearWords(parseInt(y, 10)));
  s = s.replace(/\b\d+\b/g, (m) => numWords(parseInt(m, 10)));
  s = s.replace(/\s*[—–]\s*/g, ", ");
  s = s.replace(/,\s*([,.;:!?])/g, "$1");
  s = s.replace(/([.!?]"?),/g, "$1");
  s = s.replace(/"\s*,\s*"/g, '", "');
  s = s.replace(/^\s*,\s*/, "");
  s = s.replace(/\s+,/g, ",");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

/** Split after . ! ? (and an optional closing quote) where the next word starts a sentence. */
export function splitSentences(para: string): string[] {
  const parts = para.split(/(?<=[.!?])("?)\s+(?=["'A-Z])/);
  const out: string[] = [];
  let buf = "";
  parts.forEach((p, i) => {
    if (i % 2 === 1) {
      buf += p ?? "";
      return;
    }
    if (buf) out.push(buf.trim());
    buf = p;
  });
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

const LONG_SEPS = [
  /(?<=;)\s+/,
  /(?<=:)\s+/,
  /(?<=,)\s+(?=(?:and|but|for|yet|or|so|that|which|who|when|while|if|though|because)\b)/,
  /(?<=,)\s+/,
];

/** Break an over-long sentence at ; then : then a conjunction after a comma, then any comma. */
export function splitLong(sentence: string, limit = MAX_CHUNK_CHARS): string[] {
  if (sentence.length <= limit) return [sentence];
  for (const sep of LONG_SEPS) {
    const pieces = sentence.split(sep);
    if (pieces.length > 1) {
      const chunks: string[] = [];
      let cur = "";
      for (const p of pieces) {
        if (cur && cur.length + 1 + p.length > limit) {
          chunks.push(cur);
          cur = p;
        } else {
          cur = (cur + " " + p).trim();
        }
      }
      if (cur) chunks.push(cur);
      if (chunks.length > 1) return chunks.flatMap((ch) => splitLong(ch, limit));
    }
  }
  const words = sentence.split(/\s+/).filter(Boolean);
  const half = Math.floor(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
}

/** "09-25" → "September the twenty-fifth". */
export function dateWords(day: string): string {
  const [mm, dd] = day.split("-").map((x) => parseInt(x, 10));
  return `${MONTHS[mm - 1]} the ${ordinalWords(dd)}`;
}

/** The whole reading as spoken segments. Mirrors `build_script()` in the Python script. */
export function buildSpeechScript(day: string, slot: DevotionSlot, entry: DevotionEntry): SpeechSegment[] {
  const segs: SpeechSegment[] = [];
  segs.push({ text: `${capitalize(slot)}, ${dateWords(day)}.`, pause: PAUSE.heading });
  if (entry.ref) segs.push({ text: speakKeyRef(entry.ref) + ".", pause: PAUSE.ref });
  const paras = entry.text.split("\n\n").filter((p) => p.trim());
  paras.forEach((para, pi) => {
    let sentences = splitSentences(normalise(para));
    const paraPause = pi === 0 ? PAUSE.keyverse : PAUSE.paragraph;
    // Numbered heads ("1. He is the Physician") -> "First, he is the Physician".
    if (sentences.length) {
      const m = /^(\w+)\.\s+(.*)$/.exec(sentences[0]);
      const raw = /^(\d+)\.\s/.exec(para);
      if (raw && m) {
        sentences[0] = `${LIST_ORD[parseInt(raw[1], 10)] ?? m[1]}, ${m[2]}`;
      } else if (raw && /^\w+\.$/.test(sentences[0]) && sentences.length > 1) {
        sentences = [`${LIST_ORD[parseInt(raw[1], 10)] ?? sentences[0]}, ${sentences[1]}`, ...sentences.slice(2)];
      }
    }
    sentences.forEach((sent, si) => {
      const chunks = splitLong(sent);
      chunks.forEach((ch, ci) => {
        const lastChunk = ci === chunks.length - 1;
        const lastSent = si === sentences.length - 1;
        const pause = lastChunk && lastSent ? paraPause : lastChunk ? PAUSE.sentence : PAUSE.clause;
        segs.push({ text: ch, pause });
      });
    });
  });
  segs[segs.length - 1] = { ...segs[segs.length - 1], pause: 0.6 };
  return segs;
}

/** The script in the Python `--print-text` format, for tests and debugging. */
export function formatScript(day: string, slot: DevotionSlot, segs: SpeechSegment[]): string {
  return [`### ${slot}/${day}`, ...segs.map((s) => `[${s.pause.toFixed(2)}] ${s.text}`), ""].join("\n");
}

#!/usr/bin/env python3
"""
Build spoken MP3s of Spurgeon's "Morning and Evening" from the bundled text.

Input:  public/data/devotional/spurgeon.json   (built by scripts/build-devotional.mjs)
Output: build/devotional-audio/ (gitignored)
          morning/MM-DD.mp3, evening/MM-DD.mp3, manifest.json

Model:  Kokoro-82M v1.0 (Apache-2.0 weights) run through kokoro-onnx (MIT) on the CPU.
        The ONNX model and voice pack are downloaded once into ~/.cache/bread-of-life/kokoro/
        and checked against pinned SHA-256 sums.

Setup (a venv, never system pip; espeak-ng comes bundled with the wheel):
    uv venv --python 3.12 .venv-devaudio
    VIRTUAL_ENV=.venv-devaudio uv pip install -r scripts/build-devotional-audio.requirements.txt
    ffmpeg must be on PATH.

Examples:
    .venv-devaudio/bin/python scripts/build-devotional-audio.py --days 10-03..10-05
    .venv-devaudio/bin/python scripts/build-devotional-audio.py --days 09-25 --slot morning --voice bm_fable
    .venv-devaudio/bin/python scripts/build-devotional-audio.py --print-text --days 12-17 --slot morning

The run is resumable: a reading whose MP3 exists and whose manifest entry matches the
current text, voice, speed and model is skipped. The manifest is rewritten after every file.

See docs/DEVOTIONAL-AUDIO.md.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXT_FILE = ROOT / "public/data/devotional/spurgeon.json"
DEFAULT_OUT = ROOT / "build/devotional-audio"
CACHE_DIR = Path(os.environ.get("BOL_KOKORO_DIR", Path.home() / ".cache/bread-of-life/kokoro"))

MODEL = {
    "name": "Kokoro-82M",
    "version": "v1.0",
    "licence": "Apache-2.0",
    "runtime": "kokoro-onnx",
    "files": {
        "kokoro-v1.0.onnx": {
            "url": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
            "sha256": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
        },
        "voices-v1.0.bin": {
            "url": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
            "sha256": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
        },
    },
}
# Bump when the normaliser or the audio assembly changes in a way that should regenerate files.
PIPELINE_VERSION = 2

SAMPLE_RATE = 24000
SLOTS = {"m": "morning", "e": "evening"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]

# Pauses in seconds, placed between segments after edge silence is trimmed.
PAUSE = {
    "heading": 0.7,   # after "Morning, October the third."
    "ref": 0.5,       # after the key-verse reference
    "keyverse": 1.1,  # after the key verse, before the body
    "paragraph": 0.75,
    "sentence": 0.32,
    "clause": 0.18,   # where an over-long sentence had to be split
}
MAX_CHUNK_CHARS = 280  # Kokoro's limit is 510 phonemes; ~280 characters stays well inside it.

# ---------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------
_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
         "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
         "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
_ORD = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth",
        "nine": "ninth", "twelve": "twelfth"}


def num_words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        t, o = divmod(n, 10)
        return _TENS[t] + ("-" + _ONES[o] if o else "")
    if n < 1000:
        h, r = divmod(n, 100)
        return _ONES[h] + " hundred" + (" and " + num_words(r) if r else "")
    th, r = divmod(n, 1000)
    return num_words(th) + " thousand" + ((" and " if r < 100 else " ") + num_words(r) if r else "")


def ordinal_words(n: int) -> str:
    w = num_words(n)
    head, sep, last = w.rpartition("-") if "-" in w else w.rpartition(" ")
    if last in _ORD:
        last = _ORD[last]
    elif last.endswith("y"):
        last = last[:-1] + "ieth"
    else:
        last += "th"
    return head + sep + last


def year_words(n: int) -> str:
    hi, lo = divmod(n, 100)
    if lo == 0:
        return num_words(hi) + " hundred"
    return num_words(hi) + " " + (("oh " + _ONES[lo]) if lo < 10 else num_words(lo))


# ---------------------------------------------------------------------------
# Scripture references
# ---------------------------------------------------------------------------
BOOK_ABBR = {
    "gen": "Genesis", "ex": "Exodus", "exod": "Exodus", "lev": "Leviticus", "num": "Numbers",
    "deut": "Deuteronomy", "jos": "Joshua", "josh": "Joshua", "judg": "Judges", "sam": "Samuel",
    "kings": "Kings", "king": "Kings", "kgs": "Kings", "ch": "Chronicles", "chron": "Chronicles",
    "neh": "Nehemiah", "esth": "Esther", "ps": "Psalm", "psa": "Psalm", "prov": "Proverbs",
    "eccl": "Ecclesiastes", "eccles": "Ecclesiastes", "sol": "Solomon", "isa": "Isaiah",
    "jer": "Jeremiah", "lam": "Lamentations", "ezek": "Ezekiel", "dan": "Daniel", "hos": "Hosea",
    "mic": "Micah", "hab": "Habakkuk", "zech": "Zechariah", "mal": "Malachi",
    "matt": "Matthew", "mat": "Matthew", "mk": "Mark", "lk": "Luke", "jn": "John", "rom": "Romans",
    "cor": "Corinthians", "gal": "Galatians", "eph": "Ephesians", "phil": "Philippians",
    "col": "Colossians", "thess": "Thessalonians", "tim": "Timothy", "tit": "Titus",
    "philem": "Philemon", "heb": "Hebrews", "jas": "James", "pet": "Peter", "rev": "Revelation",
}
BOOK_NAMES = sorted({
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
    "Samuel", "Kings", "Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalm", "Psalms",
    "Proverbs", "Ecclesiastes", "Song of Solomon", "Song of Sol", "Isaiah", "Jeremiah",
    "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
    "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke",
    "John", "Acts", "Romans", "Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
    "Thessalonians", "Timothy", "Titus", "Philemon", "Hebrews", "James", "Peter", "Jude",
    "Revelation",
}, key=len, reverse=True)
SINGLE_CHAPTER = {"Obadiah", "Philemon", "Jude", "John"}  # "John" only with a 2/3 prefix
_BOOK_ALT = "|".join(re.escape(b) for b in BOOK_NAMES) + "|" + "|".join(
    re.escape(a.capitalize()) + r"\." for a in BOOK_ABBR)
REF_RE = re.compile(
    r"(?:\b([123])\s+)?\b(" + _BOOK_ALT + r")\.?,?\s+(\d+)(?::(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*))?"
    r"(?![\d:])"
)
_PREFIX = {"1": "First", "2": "Second", "3": "Third"}


def _verse_list(spec: str) -> str:
    parts = [p.strip() for p in spec.split(",") if p.strip()]
    words = []
    for p in parts:
        if re.search(r"[-–]", p):
            a, b = re.split(r"\s*[-–]\s*", p)
            words.append(f"{num_words(int(a))} to {num_words(int(b))}")
        else:
            words.append(num_words(int(p)))
    plural = len(parts) > 1 or any(re.search(r"[-–]", p) for p in parts)
    joined = words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]
    return ("verses " if plural else "verse ") + joined


def speak_ref(prefix: str | None, book: str, chapter: str, verses: str | None) -> str:
    b = book.rstrip(".")
    b = BOOK_ABBR.get(b.lower(), b)
    if b in ("Sol", "Song of Sol", "Solomon"):
        b = "Song of Solomon"
    name = (_PREFIX[prefix] + " " if prefix else "") + b
    single = b in ("Obadiah", "Philemon", "Jude") or (b == "John" and prefix in ("2", "3"))
    if single and verses is None:
        return f"{name}, verse {num_words(int(chapter))}"
    if b in ("Psalm", "Psalms"):
        head = f"Psalm {num_words(int(chapter))}"
    else:
        head = f"{name} chapter {num_words(int(chapter))}"
    return head if verses is None else f"{head}, {_verse_list(verses)}"


def _ref_sub(m: re.Match) -> str:
    prefix, book, chapter, verses = m.group(1), m.group(2), m.group(3), m.group(4)
    # "Song of Sol. 4:1" arrives as book "Sol." after "Song of " already in text; handled below.
    return speak_ref(prefix, book, chapter, verses)


def speak_key_ref(ref: str) -> str:
    m = REF_RE.fullmatch(ref.strip())
    if not m:
        raise ValueError(f"cannot parse key reference {ref!r}")
    return _ref_sub(m)


# ---------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------
ABBREV = [
    (r"\bMr\.", "Mister"), (r"\bMrs\.", "Missus"), (r"\bDr\.", "Doctor"), (r"\bSt\.", "Saint"),
    (r"\bviz\.,?", "namely,"), (r"\betc\.", "et cetera."), (r"\bi\.e\.", "that is,"),
    (r"\be\.g\.", "for example,"), (r"&c\.", "et cetera."),
]
LIST_ORD = {1: "First", 2: "Second", 3: "Third", 4: "Fourth", 5: "Fifth", 6: "Sixth",
            7: "Seventh", 8: "Eighth", 9: "Ninth", 10: "Tenth"}


def normalise(text: str) -> str:
    s = text
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("…", "...")
    s = re.sub(r",(?=[A-Za-z])", ", ", s)
    # Bracketed glosses read as asides: "[or, the evil one]" -> ", or, the evil one,"
    s = re.sub(r"\s*\[([^\]]+)\]", r", \1,", s)
    # Parenthesised references: "(Ps. 139:16)" -> ", Psalm 139, verse 16," ; "(read Col. 2:10-13)"
    s = re.sub(r"\s*\((read\s+)?([^()]*\d[^()]*)\)", lambda m: ", " + (m.group(1) or "") + m.group(2) + ",", s)
    s = re.sub(r"\s*\(([^()]*)\)", r", \1,", s)
    s = re.sub(r"Song of Sol\.", "Song of Solomon", s)
    s = REF_RE.sub(_ref_sub, s)
    for pat, rep in ABBREV:
        s = re.sub(pat, rep, s)
    s = re.sub(r"\bWilliam III\b", "William the Third", s)
    s = re.sub(r"\bA B C\b", "A, B, C", s)
    s = re.sub(r"\bI AM\b", "I Am", s)
    # Shouted emphasis (TAKE THE WATER, YES, NOW): lower-case so it is not spelled out.
    s = re.sub(r"\b(?!I\b)[A-Z]{2,}\b", lambda m: m.group(0).capitalize() if len(m.group(0)) > 1 else m.group(0), s)
    s = re.sub(r"\bby-and-bye?\b", "by and by", s, flags=re.I)
    s = re.sub(r"\bfour-and-twenty\b", "four and twenty", s)
    # Years and any stray numbers.
    s = re.sub(r"\b(1[0-9]{3})\b", lambda m: year_words(int(m.group(1))), s)
    s = re.sub(r"\b\d+\b", lambda m: num_words(int(m.group(0))), s)
    # Dashes become commas: Kokoro reads an em dash inconsistently.
    s = re.sub(r"\s*[—–]\s*", ", ", s)
    s = re.sub(r",\s*([,.;:!?])", r"\1", s)
    s = re.sub(r"([.!?]\"?),", r"\1", s)
    s = re.sub(r'"\s*,\s*"', '", "', s)
    s = re.sub(r"^\s*,\s*", "", s)
    s = re.sub(r"\s+,", ",", s)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s


def split_sentences(para: str) -> list[str]:
    # Split after . ! ? (optionally followed by a closing quote) when the next word starts
    # a new sentence. Keeps "Mister Jay" intact because the abbreviation is already expanded.
    parts = re.split(r"(?<=[.!?])(\"?)\s+(?=[\"'A-Z])", para)
    out, buf = [], ""
    for i, p in enumerate(parts):
        if i % 2 == 1:
            buf += p
            continue
        if buf:
            out.append(buf.strip())
        buf = p
    if buf.strip():
        out.append(buf.strip())
    return [x for x in out if x]


def split_long(sentence: str, limit: int = MAX_CHUNK_CHARS) -> list[str]:
    if len(sentence) <= limit:
        return [sentence]
    for sep in (r"(?<=;)\s+", r"(?<=:)\s+", r"(?<=,)\s+(?=(?:and|but|for|yet|or|so|that|which|who|when|while|if|though|because)\b)", r"(?<=,)\s+"):
        pieces = re.split(sep, sentence)
        if len(pieces) > 1:
            chunks, cur = [], ""
            for p in pieces:
                if cur and len(cur) + 1 + len(p) > limit:
                    chunks.append(cur)
                    cur = p
                else:
                    cur = (cur + " " + p).strip()
            if cur:
                chunks.append(cur)
            if len(chunks) > 1:
                return [c for ch in chunks for c in split_long(ch, limit)]
    words = sentence.split()
    half = len(words) // 2
    return [" ".join(words[:half]), " ".join(words[half:])]


def date_words(day: str) -> str:
    mm, dd = (int(x) for x in day.split("-"))
    return f"{MONTHS[mm - 1]} the {ordinal_words(dd)}"


def build_script(day: str, slot: str, entry: dict) -> list[tuple[str, float]]:
    """Return [(text, pause_after_seconds), ...] for one reading."""
    segs: list[tuple[str, float]] = []
    segs.append((f"{SLOTS[slot].capitalize()}, {date_words(day)}.", PAUSE["heading"]))
    if entry.get("ref"):
        segs.append((speak_key_ref(entry["ref"]) + ".", PAUSE["ref"]))
    paras = [p for p in entry["text"].split("\n\n") if p.strip()]
    for pi, para in enumerate(paras):
        sentences = split_sentences(normalise(para))
        para_pause = PAUSE["keyverse"] if pi == 0 else PAUSE["paragraph"]
        # Numbered heads ("1. He is the Physician") -> "First, he is the Physician".
        if sentences:
            m = re.match(r"^(\w+)\.\s+(.*)$", sentences[0])
            raw = re.match(r"^(\d+)\.\s", para)
            if raw and m:
                sentences[0] = f"{LIST_ORD.get(int(raw.group(1)), m.group(1))}, {m.group(2)}"
            elif raw and re.fullmatch(r"\w+\.", sentences[0]) and len(sentences) > 1:
                sentences = [f"{LIST_ORD.get(int(raw.group(1)), sentences[0])}, {sentences[1]}"] + sentences[2:]
        for si, sent in enumerate(sentences):
            chunks = split_long(sent)
            for ci, ch in enumerate(chunks):
                last_chunk = ci == len(chunks) - 1
                last_sent = si == len(sentences) - 1
                pause = para_pause if (last_chunk and last_sent) else (PAUSE["sentence"] if last_chunk else PAUSE["clause"])
                segs.append((ch, pause))
    segs[-1] = (segs[-1][0], 0.6)  # tail
    return segs


# Pronunciation fixes. espeak-ng (Kokoro's phonemiser) gets many biblical names wrong,
# e.g. "Gethsemane" as "GETH-sim-ain". Each entry is the IPA Kokoro should say instead
# (British; the American voices use the same entries). A trailing "'s" adds "z".
LEXICON = {
    "Gethsemane": "ɡɛθsˈɛməni", "Ecclesiastes": "ɪklˌiːziˈastiːz", "Philemon": "fɪlˈiːmən",
    "Boaz": "bˈəʊaz", "Joash": "dʒˈəʊaʃ", "Leah": "lˈiːə", "Joel": "dʒˈəʊəl",
    "Barnabas": "bˈɑːnəbəs", "Caiaphas": "kˈaɪəfəs", "Ahasuerus": "ɐhˌazjuːˈɪəɹəs",
    "Amalek": "ˈaməlɛk", "Amalekites": "ˈaməlɛkˌaɪts", "Bathsheba": "baθʃˈiːbə",
    "Melchizedek": "mɛlkˈɪzədɛk", "Nebuchadnezzar": "nˌɛbjʊkədnˈɛzə", "Emmaus": "ɛmˈeɪəs",
    "Mamre": "mˈamɹi", "Sion": "sˈaɪən", "Elimelech": "ɪlˈɪməlɛk", "Meshach": "mˈiːʃak",
    "Shadrach": "ʃˈeɪdɹak", "Mesech": "mˈiːsɛk", "Onesimus": "əʊnˈɛsɪməs",
    "Manasseh": "mɐnˈasə", "Jehoshaphat": "dʒɪhˈɒʃəfat", "Jehoiachin": "dʒɪhˈɔɪəkɪn",
    "Zephaniah": "zˌɛfənˈaɪə", "Sennacherib": "sɪnˈakəɹɪb", "Silas": "sˈaɪləs",
    "Gomorrah": "ɡəmˈɒɹə", "Levi": "lˈiːvaɪ", "Mene": "mˈiːni", "Remphan": "ɹˈɛmfan",
    "Sarepta": "sɐɹˈɛptə", "Ninevites": "nˈɪnɪvaɪts", "Kilda": "kˈɪldə",
    "Boanerges": "bˌəʊənˈɜːdʒiːz", "Esaias": "ɪzˈaɪəs", "Engedi": "ɛnɡˈɛdi",
    "Gennesaret": "ɡɪnˈɛsəɹɛt", "Cherith": "kˈɪəɹɪθ", "Bochim": "bˈəʊkɪm",
    "Peninnah": "pɪnˈɪnə", "Shekinah": "ʃɪkˈaɪnə", "Mephibosheth": "mɪfˈɪbəʃɛθ",
    "Zerubbabel": "zɪɹˈʌbəbəl", "Methuselah": "mɪθjˈuːzələ", "Hazael": "hɐzˈeɪəl",
    "Methinks": "mɪθˈɪŋks", "Ahimaaz": "ɐhˈɪmeɪaz", "Ahithophel": "ɐhˈɪθəfɛl",
    "Asahel": "ˈasəhɛl", "Absalom": "ˈabsələm",
}
LEX_RE = re.compile(r"\b(" + "|".join(sorted(map(re.escape, LEXICON), key=len, reverse=True)) + r")('s)?\b")


# ---------------------------------------------------------------------------
# Synthesis and encoding
# ---------------------------------------------------------------------------
def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def ensure_model() -> tuple[Path, Path]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, meta in MODEL["files"].items():
        p = CACHE_DIR / name
        if not p.exists():
            print(f"Downloading {name} ...", file=sys.stderr)
            tmp = p.with_suffix(p.suffix + ".part")
            urllib.request.urlretrieve(meta["url"], tmp)
            tmp.rename(p)
        got = sha256_file(p)
        if got != meta["sha256"]:
            raise SystemExit(f"{p}: sha256 {got} does not match pinned {meta['sha256']}")
        paths.append(p)
    return paths[0], paths[1]


def trim(audio, thresh: float = 0.003, keep: int = int(0.04 * SAMPLE_RATE)):
    import numpy as np
    idx = np.where(np.abs(audio) > thresh)[0]
    if idx.size == 0:
        return audio[:0]
    a, b = max(idx[0] - keep, 0), min(idx[-1] + keep, len(audio))
    return audio[a:b]


class Synth:
    def __init__(self, voice: str, speed: float, lang: str | None):
        from kokoro_onnx import Kokoro
        import onnxruntime as ort
        onnx, voices = ensure_model()
        threads = int(os.environ.get("BOL_TTS_THREADS", "0"))
        if threads:
            so = ort.SessionOptions()
            so.intra_op_num_threads = threads
            sess = ort.InferenceSession(str(onnx), sess_options=so, providers=["CPUExecutionProvider"])
            self.k = Kokoro.from_session(sess, str(voices))
        else:
            self.k = Kokoro(str(onnx), str(voices))
        if voice not in self.k.get_voices():
            raise SystemExit(f"unknown voice {voice}; choose from {sorted(self.k.get_voices())}")
        self.voice, self.speed = voice, speed
        self.lang = lang or ("en-gb" if voice.startswith("b") else "en-us")

    def phonemes(self, text: str) -> str:
        """espeak phonemes for `text`, with LEXICON words substituted."""
        out, pos = [], 0
        for m in LEX_RE.finditer(text):
            if text[pos:m.start()].strip():
                out.append(self.k.tokenizer.phonemize(text[pos:m.start()], self.lang))
            out.append(LEXICON[m.group(1)] + ("z" if m.group(2) else ""))
            pos = m.end()
        if text[pos:].strip():
            out.append(self.k.tokenizer.phonemize(text[pos:], self.lang))
        ph = " ".join(out)
        return re.sub(r"\s+([,.;:!?])", r"\1", ph)

    def render(self, segs: list[tuple[str, float]]):
        import numpy as np
        out = []
        for text, pause in segs:
            audio, sr = self.k.create(self.phonemes(text), voice=self.voice, speed=self.speed,
                                      lang=self.lang, is_phonemes=True)
            assert sr == SAMPLE_RATE
            out.append(trim(np.asarray(audio, dtype=np.float32)))
            out.append(np.zeros(int(pause * SAMPLE_RATE), dtype=np.float32))
        return np.concatenate([np.zeros(int(0.25 * SAMPLE_RATE), dtype=np.float32)] + out)


def encode_mp3(wav: Path, mp3: Path, bitrate: int, lufs: float, tags: dict) -> None:
    target = f"I={lufs}:TP=-1.5:LRA=11"
    p1 = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav), "-af",
         f"loudnorm={target}:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, check=True)
    js = json.loads(p1.stderr[p1.stderr.rindex("{"):p1.stderr.rindex("}") + 1])
    af = (f"loudnorm={target}:measured_I={js['input_i']}:measured_TP={js['input_tp']}"
          f":measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}"
          f":offset={js['target_offset']}:linear=true")
    meta = []
    for k, v in tags.items():
        meta += ["-metadata", f"{k}={v}"]
    tmp = mp3.with_suffix(".part.mp3")
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-af", af,
         "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "libmp3lame", "-b:a", f"{bitrate}k",
         "-id3v2_version", "3", *meta, str(tmp)],
        check=True)
    tmp.replace(mp3)


def probe_duration(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", str(p)], capture_output=True, text=True, check=True)
    return round(float(r.stdout.strip()), 2)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def parse_days(spec: str | None, all_days: list[str]) -> list[str]:
    if not spec:
        return all_days
    chosen: list[str] = []
    for part in spec.split(","):
        part = part.strip()
        if ".." in part:
            a, b = part.split("..")
            chosen += [d for d in all_days if a <= d <= b]
        elif part in all_days:
            chosen.append(part)
        else:
            raise SystemExit(f"unknown day {part!r} (use MM-DD)")
    return list(dict.fromkeys(chosen))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", help="MM-DD, MM-DD..MM-DD, or a comma list (default: all 366)")
    ap.add_argument("--slot", choices=["morning", "evening", "both"], default="both")
    ap.add_argument("--voice", default="bm_george", help="Kokoro voice id (default bm_george)")
    ap.add_argument("--speed", type=float, default=0.92, help="speaking rate, 1.0 = model default")
    ap.add_argument("--lang", help="espeak language (default en-gb for b* voices, else en-us)")
    ap.add_argument("--bitrate", type=int, default=48, help="MP3 kbps (mono)")
    ap.add_argument("--lufs", type=float, default=-18.0, help="integrated loudness target")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--force", action="store_true", help="regenerate even when up to date")
    ap.add_argument("--print-text", action="store_true", help="print the spoken script and exit")
    ap.add_argument("--keep-wav", action="store_true", help="keep the unencoded WAV next to the MP3")
    args = ap.parse_args()

    data = json.loads(TEXT_FILE.read_text(encoding="utf-8"))
    days = parse_days(args.days, sorted(data))
    slots = ["m", "e"] if args.slot == "both" else [args.slot[0]]
    jobs = [(d, s) for d in days for s in slots if s in data[d]]

    if args.print_text:
        for d, s in jobs:
            print(f"### {SLOTS[s]}/{d}")
            for t, p in build_script(d, s, data[d][s]):
                print(f"[{p:.2f}] {t}")
            print()
        return

    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found on PATH")
    out: Path = args.out
    man_path = out / "manifest.json"
    manifest = json.loads(man_path.read_text()) if man_path.exists() else {}
    model_id = f"{MODEL['name']} {MODEL['version']}"
    manifest.update({
        "schema": 1,
        "title": "Morning and Evening",
        "author": "C. H. Spurgeon",
        "model": {"name": MODEL["name"], "version": MODEL["version"], "licence": MODEL["licence"],
                  "runtime": MODEL["runtime"],
                  "sha256": {k: v["sha256"] for k, v in MODEL["files"].items()}},
        "format": {"codec": "mp3", "bitrateKbps": args.bitrate, "sampleRate": SAMPLE_RATE,
                   "channels": 1, "loudnessLufs": args.lufs},
    })
    items: dict = manifest.setdefault("items", {})

    def save_manifest():
        manifest["generatedAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        manifest["items"] = dict(sorted(items.items()))
        manifest["totals"] = {"count": len(items),
                              "durationSec": round(sum(i["durationSec"] for i in items.values()), 1),
                              "bytes": sum(i["bytes"] for i in items.values())}
        tmp = man_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(manifest, indent=1) + "\n")
        tmp.replace(man_path)

    synth = None
    t_all, audio_all, done = time.time(), 0.0, 0
    for n, (d, s) in enumerate(jobs, 1):
        rid = f"{SLOTS[s]}/{d}"
        mp3 = out / f"{rid}.mp3"
        entry = data[d][s]
        segs = build_script(d, s, entry)
        text_sha = hashlib.sha256(json.dumps([segs, PIPELINE_VERSION, LEXICON]).encode()).hexdigest()
        prev = items.get(rid)
        if (not args.force and mp3.exists() and prev and prev.get("textSha256") == text_sha
                and prev.get("voice") == args.voice and prev.get("speed") == args.speed
                and prev.get("model") == model_id and prev.get("sha256") == sha256_file(mp3)):
            print(f"[{n}/{len(jobs)}] {rid} up to date")
            continue
        if synth is None:
            synth = Synth(args.voice, args.speed, args.lang)
        mp3.parent.mkdir(parents=True, exist_ok=True)
        t0 = time.time()
        audio = synth.render(segs)
        synth_s = time.time() - t0
        import soundfile as sf
        with tempfile.TemporaryDirectory() as td:
            wav = Path(td) / "a.wav"
            sf.write(wav, audio, SAMPLE_RATE, subtype="PCM_16")
            mm, dd = (int(x) for x in d.split("-"))
            encode_mp3(wav, mp3, args.bitrate, args.lufs, {
                "title": f"{SLOTS[s].capitalize()}, {MONTHS[mm - 1]} {dd}",
                "artist": "C. H. Spurgeon", "album": "Morning and Evening",
                "track": str(dt.date(2024, mm, dd).timetuple().tm_yday * 2 - (1 if s == "m" else 0)),
                "comment": f"Read by {args.voice} ({model_id}); text public domain",
            })
            if args.keep_wav:
                shutil.copy(wav, mp3.with_suffix(".wav"))
        dur = probe_duration(mp3)
        items[rid] = {
            "id": rid, "path": f"{rid}.mp3", "slot": SLOTS[s], "day": d, "ref": entry.get("ref"),
            "title": f"{SLOTS[s].capitalize()} — {MONTHS[mm - 1][:3]} {dd}",
            "durationSec": dur, "bytes": mp3.stat().st_size, "sha256": sha256_file(mp3),
            "voice": args.voice, "speed": args.speed, "model": model_id, "textSha256": text_sha,
        }
        save_manifest()
        done += 1
        audio_all += dur
        print(f"[{n}/{len(jobs)}] {rid} {dur:.0f}s audio in {synth_s:.0f}s synth "
              f"({dur / max(synth_s, 1e-6):.1f}x realtime)", flush=True)
    if done:
        wall = time.time() - t_all
        print(f"Done: {done} files, {audio_all / 60:.1f} min audio, {wall / 60:.1f} min wall "
              f"({audio_all / wall:.1f}x realtime overall)")
    elif jobs:
        save_manifest()


if __name__ == "__main__":
    main()

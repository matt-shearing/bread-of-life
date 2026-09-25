# Devotional audio

Spurgeon's *Morning and Evening* is read aloud by a neural voice, generated once on a desktop
and served as static MP3 files. The app plays a reading from those files and falls back to
the phone's own text-to-speech voice when a file is not available (plan section 5, option C).
This document covers the generation side: the model, the voices, how to run the script, where
the files should live, and the manifest the app will read.

## Model and licence

The script uses **Kokoro-82M v1.0**, run on the CPU through **kokoro-onnx**.

| Part | Licence | Source |
|---|---|---|
| Kokoro-82M weights and voice pack | Apache-2.0 | [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) |
| kokoro-onnx runtime and ONNX export | MIT | [thewh1teagle/kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) |
| espeak-ng, the phonemiser (bundled in `espeakng-loader`) | GPL-3.0 | used as a tool; nothing of it ships in the audio |
| *Morning and Evening* text | Public domain | CCEL ThML, via `scripts/build-devotional.mjs` |

Apache-2.0 allows the generated audio to be redistributed publicly and commercially. The
audio carries no licence obligation of its own; the MP3 comment tag names the voice and model.

Why Kokoro, over the alternatives checked in September 2026:

- **Kokoro-82M** is small (325 MB ONNX, under 1 GB of RAM while running), fast on a CPU,
  deterministic, and does not hallucinate or skip text on long input, which matters for 732
  readings nobody will proof-listen in full. It has several British and American voices.
- **Piper** is fast but sounds flatter, and its current code (`piper1-gpl`) is GPL-3.0. Each
  voice carries the licence of its training data, and several popular English voices are
  unclear or non-commercial.
- **Chatterbox** (MIT) and other large voice-cloning models sound more expressive, but they
  need a reference recording whose own rights would have to be cleared, need a GPU for a
  sensible run time, and can drift or repeat on long passages.
- **F5-TTS** weights are CC-BY-NC, which rules out public redistribution. Newer long-form
  models (Hume TADA, Dots TTS) were not tested: their licences and memory needs were unclear,
  and this machine had about 7 GB of RAM free.

## Voices

Samples of the same reading (Morning, 25 September) were made in four voices, plus one full
Evening reading in the default voice. Matt picks by ear; the script's default is `bm_george`.

| Voice | Description |
|---|---|
| `bm_george` | British man, lower and slower; the most measured of the set. Default. |
| `bm_fable` | British man, lighter and a little brighter. |
| `am_michael` | American man, warm and even. |
| `af_heart` | American woman; Kokoro's highest-rated voice for recording quality. |

Other English voices (`bm_lewis`, `bm_daniel`, `am_fenrir`, `bf_emma`) also work. British
voices phonemise in `en-gb`, American ones in `en-us`.

## What a reading sounds like

Each file reads, in order:

1. The heading: "Morning, October the third."
2. The key reference: "Psalm twenty-three, verse one." or "Romans chapter three, verse
   twenty-six."
3. The key verse, followed by a longer pause.
4. The body, paragraph by paragraph.

Pauses are placed by the script after trimming the model's own edge silence: 0.7 s after the
heading, 1.1 s after the key verse, 0.75 s between paragraphs, 0.32 s between sentences and
0.18 s where an over-long sentence had to be split.

### Text normalisation

The script rewrites the text for speech before synthesis. Run it with `--print-text` to see
exactly what will be spoken.

- Scripture references, in the heading and in the body, become words: "2 Ch. 20:37" becomes
  "Second Chronicles chapter twenty, verse thirty-seven"; "(Gen. 32:24-30)" becomes "Genesis
  chapter thirty-two, verses twenty-four to thirty"; "Jude 24" becomes "Jude, verse
  twenty-four".
- Abbreviations are expanded: Mr., Dr., St., viz., etc.
- Numbered heads ("1. He is the Physician") become "First, he is the Physician".
- Shouted capitals (TAKE THE WATER OF LIFE FREELY) are lower-cased so they are not spelt out;
  "I AM" stays a name.
- Years become "sixteen eighty-eight"; "William III" becomes "William the Third".
- Em dashes become commas, because Kokoro reads them inconsistently.
- A pronunciation lexicon (`LEXICON` in the script) supplies the IPA for about fifty biblical
  names that espeak-ng gets wrong, such as Gethsemane, Ecclesiastes, Philemon, Boaz,
  Melchizedek and Nebuchadnezzar. Add to it when a listener reports a bad name.

Long sentences are split at semicolons, colons and then commas so that each chunk stays under
280 characters, well inside Kokoro's 510-phoneme limit.

## How to run

The script needs Python 3.12, a venv and `ffmpeg`. espeak-ng comes inside the Python wheel.

```sh
uv venv --python 3.12 .venv-devaudio
VIRTUAL_ENV=.venv-devaudio uv pip install -r scripts/build-devotional-audio.requirements.txt

# three days, both readings, default voice
.venv-devaudio/bin/python scripts/build-devotional-audio.py --days 10-03..10-05

# one reading in another voice, to a separate folder
.venv-devaudio/bin/python scripts/build-devotional-audio.py --days 09-25 --slot morning \
  --voice bm_fable --out build/devotional-audio-bm_fable

# show the spoken text without synthesising
.venv-devaudio/bin/python scripts/build-devotional-audio.py --print-text --days 12-17

# everything (about ten hours on tetelestai)
.venv-devaudio/bin/python scripts/build-devotional-audio.py
```

On first use the script downloads the model (`kokoro-v1.0.onnx`, `voices-v1.0.bin`) into
`~/.cache/bread-of-life/kokoro/` and checks both against pinned SHA-256 sums. Set
`BOL_KOKORO_DIR` to use another folder, and `BOL_TTS_THREADS` to limit CPU threads.

Options: `--days` takes `MM-DD`, a range `MM-DD..MM-DD` or a comma list; `--slot` takes
`morning`, `evening` or `both`; `--voice`, `--speed` (default 0.92), `--bitrate` (default 48
kbps), `--lufs` (default -18), `--out` (default `build/devotional-audio`, which is
gitignored), `--force` and `--keep-wav`.

The run is resumable. A reading is skipped when its MP3 exists and its manifest entry matches
the current spoken text, lexicon, voice, speed and model, and the file's SHA-256 still matches.
The manifest is rewritten after every file, so an interrupted run loses at most one reading.
Changing the normaliser or the lexicon regenerates only the readings whose text changed; bump
`PIPELINE_VERSION` in the script to force a full rebuild.

### Encoding

Audio is synthesised at 24 kHz, joined in memory, normalised with ffmpeg's two-pass
`loudnorm` to -18 LUFS integrated and -1.5 dBTP, and encoded as mono MP3 at 48 kbps CBR with
ID3v2.3 tags (title "Morning, October 3", artist C. H. Spurgeon, album Morning and Evening,
track number in calendar order). The measured loudness of the samples is -18.3 to -18.5 LUFS.

## Measurements on tetelestai

Measured on a Ryzen 9 7950X3D, CPU only, with Kokoro through onnxruntime 1.30.

| Measure | Value |
|---|---|
| Synthesis speed | 3.1 to 4.1 seconds of audio per second of compute |
| Including loudness and MP3 encoding | 2.8 to 3.0 times real time |
| Peak memory of the script | about 940 MB |
| Average reading | 2.3 minutes, about 830 KB at 48 kbps |

Extrapolated to all 732 readings: about **28.5 hours of audio**, **615 MB** at 48 kbps (820 MB
at 64 kbps), and about **10 hours** of wall-clock time. The GPU was not used; onnxruntime's
ROCm build is not packaged for this setup, and ten hours overnight is acceptable.

### Round-trip check

Each sample was transcribed back with faster-whisper large-v3 and compared word by word with
the spoken script. Word error rates were 0 to 1.7 per cent for the samples and 0.3 to 3.8 per
cent across twelve readings. Almost every difference is Whisper writing American spelling
(honour, labour, marvellous) or merging compounds (broad-church, bloodguiltiness). The one
large deletion, on 1 January evening, is Whisper dropping a repeated sentence: Spurgeon repeats
the key verse as the first line of the body, and a word-timed transcript confirms the audio
contains both. No dropped sentences or garbled chunk joins were found.

## Hosting

**Live hosting (since v0.4.0): a GitHub Release.** The files are assets of the prerelease
`devotional-audio-v1` on the public repo, named flat (`morning-10-03.mp3`,
`evening-10-03.mp3`) with `manifest.json` beside them; the manifest's `path` fields use those
flat names. The release is marked prerelease and not latest, so Obtainium and the release
workflows ignore it. GitHub's download URLs redirect to a signed CDN URL that supports byte
ranges, and send no CORS headers, so the app fetches the manifest with `plugin-http` (the
MP3s themselves play without CORS). A new voice or text revision goes in a new release tag
(`devotional-audio-v2`) and a one-line change to `DEVOTIONAL_AUDIO_BASE`.

The sync server was the first choice, but on 2026-09-25 its SSH port was closed at the host
firewall (even from the private network), so it could not be updated. The Caddy recipe
below still applies if the audio moves there.

**Sync server behind Caddy (recommended).** One voice is about 615 MB, which fits on the
server's disk. Caddy's `file_server` handles byte-range requests, which the Android player
and the webview need for seeking, and sets correct `Content-Type` and `ETag` headers. File
paths include the voice and a version, so every URL is immutable and can be cached for a year:

```
https://sync.breadoflife.dev/audio/spurgeon/v1/bm_george/manifest.json
https://sync.breadoflife.dev/audio/spurgeon/v1/bm_george/morning/10-03.mp3
```

```caddy
handle_path /audio/* {
    root * /srv/bol-audio
    @mp3 path *.mp3
    header @mp3 Cache-Control "public, max-age=31536000, immutable"
    header /*/manifest.json Cache-Control "public, max-age=3600"
    header Access-Control-Allow-Origin *
    file_server
}
```

Upload with `rsync -av build/devotional-audio/ server:/srv/bol-audio/spurgeon/v1/bm_george/`.

**Bandwidth.** A listener who plays both readings every day downloads about 1.7 MB a day, or
about 50 MB a month. One hundred daily listeners use about 5 GB a month; a thousand use about
50 GB. The app should cache a played file so a replay costs nothing.

**GitHub Releases as a mirror.** A release can hold 1,000 assets of up to 2 GiB each, and
GitHub does not charge for download bandwidth, so one release per voice (732 files plus the
manifest) fits. The drawbacks: asset names are flat (`morning-10-03.mp3`, not folders), every
download redirects to `objects.githubusercontent.com`, and the release lives in the public
repository's history. It is a good fallback if the sync server is down or over budget, not
the first choice.

## Manifest format

`manifest.json` sits at the root of the output folder. The app reads it to learn which
readings exist, how long each is, and the checksum to verify a download. `items` is keyed by
`id`, which is also the path without `.mp3`.

```json
{
  "schema": 1,
  "title": "Morning and Evening",
  "author": "C. H. Spurgeon",
  "model": {
    "name": "Kokoro-82M", "version": "v1.0", "licence": "Apache-2.0", "runtime": "kokoro-onnx",
    "sha256": { "kokoro-v1.0.onnx": "7d5d…", "voices-v1.0.bin": "bca6…" }
  },
  "format": { "codec": "mp3", "bitrateKbps": 48, "sampleRate": 24000, "channels": 1, "loudnessLufs": -18.0 },
  "generatedAt": "2026-09-25T07:20:00+00:00",
  "totals": { "count": 732, "durationSec": 102500.0, "bytes": 615000000 },
  "items": {
    "morning/01-01": {
      "id": "morning/01-01",
      "path": "morning/01-01.mp3",
      "slot": "morning",
      "day": "01-01",
      "ref": "Joshua 5:12",
      "title": "Morning — Jan 1",
      "durationSec": 140.66,
      "bytes": 844683,
      "sha256": "cf4a0ca137477ca3225552bbfab3781e05122670adc6f464d315dcda6a854af4",
      "voice": "bm_george",
      "speed": 0.92,
      "model": "Kokoro-82M v1.0",
      "textSha256": "781bfbd4…"
    }
  }
}
```

- `day` uses the same `MM-DD` key as `public/data/devotional/spurgeon.json`, including `02-29`.
- `path` is relative to the manifest's URL.
- `title` is ready to use as the queue `Track` title.
- `textSha256` identifies the spoken script; the app can ignore it.
- A missing item means the app should fall back to the phone's voice for that reading.

## In the app

The Devotional page (Morning and Evening each) and the dashboard's devotional card have a
**Listen** button. It plays the reading through the one audio controller as a track titled
"Morning — 25 September · Spurgeon", so it gets the mini-player, Now Playing, the lock-screen
controls and, later, Android Auto. When the reading plays to the end it is marked complete,
exactly as the "Mark complete" button does.

- **The recording is the main path.** `src/audio/devotionalAudio.ts` holds the base URL in
  one constant, `DEVOTIONAL_AUDIO_BASE`
  (`https://github.com/matt-shearing/bread-of-life/releases/download/devotional-audio-v1`). Set
  `VITE_DEVOTIONAL_AUDIO_BASE` to point a dev build at another server. The app fetches
  `manifest.json`, keeps a compact copy (id, path, length) in `localStorage`, re-checks it
  every six hours, and uses the stored copy when offline. The button shows the recording's
  length from the manifest.
- **The device's own voice is the fallback**, used when the reading is not in the manifest,
  the manifest cannot be reached, or the device is offline. It says the same words as the
  recording: `src/lib/devotionalSpeech.ts` is a line-for-line port of this script's
  normaliser, and `pnpm test:devotional-speech` compares the two (set
  `BOL_DEVAUDIO_PYTHON` to the venv's python to compare all 732 readings live). The
  pronunciation lexicon is IPA for Kokoro and is not applied to the device voice.
  - **Android:** the WebView has no usable `speechSynthesis`, so the `device-tts` plugin
    (`src-tauri/plugins/device-tts`) renders the reading with `TextToSpeech.synthesizeToFile`,
    one segment at a time with the same pauses, into one WAV in the app cache (the four
    most recent are kept), preferring an installed British English voice. The app plays it
    as a `file://` track through the native queue, as it plays a downloaded Missler chapter.
    The button shows "Preparing voice… n%" while it renders.
  - **Desktop and browser:** `window.speechSynthesis`, segment by segment
    (`src/audio/speechEngine.ts`). Its length and position are estimates. Where there is no
    voice (WebKitGTK often has none) and no recording, the button is disabled with the
    reason.

## Known gaps

- The lexicon covers the names found by scanning the corpus, but espeak-ng will still get some
  rarer words wrong. Only listening finds them; add each fix to `LEXICON`.
- Kokoro reads "Beloved" as two syllables (be-LUVD); the older three-syllable reading is not
  applied.
- The lexicon is British IPA. The American voices use it too, which is close enough for names.
- Kokoro's British voices are rated lower for recording quality than `af_heart`. That is a
  matter of taste; the samples let Matt judge.

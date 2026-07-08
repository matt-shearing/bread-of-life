# Bread of Life — Technology Landscape & Decisions (July 2026)

_What exists now that changes the calculus, and the choices we're locking in. A year on from the
first attempts, the hard problems (sourcing scripture, sourcing commentaries, verse identity,
reference parsing, offline desktop) are largely solved by mature open data + libraries._

---

## 1. The big unlock — HelloAO Free Use Bible API

<https://bible.helloao.org> — free, open-source JSON API. **No key, no rate limit, no license restriction.**

- **1000+ translations.** Per translation: verses, formatting, footnotes, **audio links, cross-references, and commentary datasets** in clean structured JSON.
- **Public-domain commentaries bundled**: Matthew Henry, Jamieson-Fausset-Brown, Adam Clarke, John Gill, Keil-Delitzsch, Tyndale — each with its own license URL (mostly CC0 / public-domain-mark).
- `GET /api/{TR}/complete.json` returns an entire translation (~7 MB for BSB). Per-chapter and per-book endpoints too. Commentaries live under `/api/c/{id}/…`.
- **`@helloao/cli`** (npm) can import USFM/USX/Codex and build a **local SQLite DB**, or self-host.

**Impact:** the entire old "bible-data-{api,static,sword}" agony and the SWORD rabbit hole are replaced
by _one data source_. We download BSB once → ship it as static JSON (fully offline). Commentary is
fetched per-chapter on demand and cached locally. **This is already wired in this repo** — see
`scripts/fetch-bible.mjs` (verified: real BSB, 66 books, 5.1 MB).

## 2. Translations & licensing

- **Berean Standard Bible (BSB)** — released **public domain / CC0** (April 30 2023). Modern, readable,
  footnotes + section headings. **This is our anchor default translation** — zero licensing risk.
- Also PD via HelloAO: **WEB, KJV, ASV, NET (notes)**, plus 1000+ more. Easy to add behind the same
  reader.
- **Copyrighted (ESV / NIV / NASB / CSB)** need a paid licensed API (e.g. API.Bible). Out of scope for
  v1; the translation interface is designed so they can slot in later without touching the reader.

## 3. Original languages, cross-refs, knowledge graph (roadmap data, not v1)

- **STEPBible-Data** (github.com/STEPBible/STEPBible-Data, **CC BY 4.0**) — TAHOT (Hebrew OT),
  TAGNT (Greek NT), TEHMC/TEGMC morphology, lexicons TBESH/TBESG/TFLSJ with **Strong's numbers**.
  This is how we do Strong's / word study properly (and `bread-of-life-25`'s 8,600-entry Strong's
  dataset is a ready-made shortcut).
- **OpenBible.info cross-references** — ~340k refs derived from Treasury of Scripture Knowledge
  (public domain), ~2 MB zip. Ship as a static dataset keyed by verse.
- **Theographic Bible Metadata** (github.com/robertrouse/theographic-bible-metadata) — knowledge graph
  of people/places/periods/passages. Powers maps, timelines, "who/where/when" later.

## 4. Reference parsing / formatting (don't hand-roll)

- **`bible-passage-reference-parser`** (openbibleinfo, MIT, Peggy grammar, 40+ languages) — parses
  "John 3:16", ranges, `[[…]]`, returns **OSIS + indices**. Use it to (a) link references inside
  commentary/devotional/journal text, (b) power the search/go-to box.
- **`Bible-Reference-Formatter`** (openbibleinfo, MIT) — OSIS → human-readable.
- **Canonical verse identity:** we adopt `commentary-parser`'s scheme — **OSIS strings + BBCCCVVV
  integer** (`book*1_000_000 + chapter*1_000 + verse`). Every highlight, note, prayer link, and
  commentary row keys off this, guaranteeing interop with Matt's own commentary corpus and any Bible
  software.

## 5. AI / MCP layer (new since the old attempts; roadmap)

- Bible-study **MCP servers** already exist to learn from / reuse: `djayatillake/studybible-mcp`
  (Greek/Hebrew lexicons + Fee & Stuart hermeneutics), `TJ-Frederick/TheologAI` (Bible + CCEL + HelloAO
  commentaries).
- **Offline vector search in SQLite** (`sqlite-vec`) runs inside Tauri's webview → **local RAG over
  scripture + commentaries + Matt's own notes + journal**, no server. This is how the "AI-first study
  assistant grounded in the app's own corpus" becomes real _without_ the RAGFlow/Milvus/Ollama sprawl
  the old master plan imagined.
- **Batch LLM enrichment via the Claude Code CLI** (`claude -p`) on the Max subscription — the cost
  lever `commentary-parser` already discovered — for bulk theming/segmentation jobs.
- Model default for any AI features: **Claude (Opus 4.8 / Haiku 4.5)** via the app's own key.

## 6. App shell & stack — DECISIONS

The prior attempts' fatal disease was indecision. Here is what we're locking in, and why.

| Layer | Choice | Why (first-principles) |
|---|---|---|
| **Shell** | **Tauri 2** (Rust) | The vision was always "self-contained, low-footprint, offline, runs anywhere." Tauri gives a small native binary (AppImage/deb for Matt's Arch/KDE). Verified installed: `tauri-cli 2.8.3`, `rustc 1.89`. The frontend is a normal web app, so it also runs in a plain browser for fast dev. |
| **Frontend** | **Vite + React 18 + TypeScript** | Largest ecosystem, `shadcn/ui` is React-native, and **no Next.js** — catalyst's own post-mortem proved a Bible reader is a client-only app that shouldn't pay the SSR tax. Vite build is trivially verifiable. |
| **Styling** | **Tailwind + shadcn/ui (Radix)** | Matches the existing `UI-guide.md` design system; accessible primitives; theme via CSS variables (light/dark). |
| **State** | **Zustand (UI only) + Dexie live queries (data)** | **One** UI-state store and **one** data source. This directly kills the "five competing state systems" bug that sank catalyst. No Context/URL/server-cache state soup. |
| **Scripture** | **Static per-book JSON, bundled** | Won the bake-off (9.05/10). 100% offline, ~10ms cached reads, dead simple. Already downloaded & verified. |
| **User data** | **Dexie (IndexedDB)** now → SQLite later | IndexedDB works in _both_ a plain browser and the Tauri webview and persists offline, so v1 needs **one** implementation. Behind a `db/` repository seam so we can move to `@tauri-apps/plugin-sql` + SQLite (for FTS + portability to the `commentary-parser` schema) without touching UI. |
| **Auth / cloud** | **None (single local user)** | Auth churn (NextAuth→Convex→Clerk) burned two attempts. v1 is local-first with zero accounts. Optional sync is a deliberate _later_ decision, not a v1 dependency. |
| **Commentary** | **HelloAO fetch-on-demand + Dexie cache**, pluggable sources | Public-domain commentary at near-zero cost, and the same `CommentarySource` interface accepts Matt's own `commentary-parser` output as just another source. |

### Explicitly rejected (and why)
- **SWORD / JSword in JS** — no production JS library; C++/binary/CORS. HelloAO + STEPBible give the
  same data as clean JSON.
- **Convex / Supabase / PocketBase for v1** — a local single-user app needs no backend; every prior
  backend added churn and offline caveats.
- **Next.js** — SSR/API-routes tax for a client-only reader (catalyst's documented conclusion).
- **RAGFlow / Milvus / Ollama sprawl** — replaced by `sqlite-vec` local vectors when AI lands.
- **The CJC / TaskMaster / orchestrator meta-framework** — this repo has a lean `CLAUDE.md` and nothing
  else. Process is not the product.

## 7. Source links

- HelloAO: <https://bible.helloao.org> · <https://bible.helloao.org/docs/reference/> · `@helloao/cli`
- BSB license: <https://berean.bible/licensing.htm>
- STEPBible-Data: <https://github.com/STEPBible/STEPBible-Data>
- OpenBible cross-refs: <https://www.openbible.info/labs/cross-references/>
- Theographic: <https://github.com/robertrouse/theographic-bible-metadata>
- Reference parser: <https://github.com/openbibleinfo/Bible-Passage-Reference-Parser>
- Bible-study MCP: <https://github.com/djayatillake/studybible-mcp> · <https://github.com/TJ-Frederick/TheologAI>
- Public-domain commentaries DB: <https://github.com/HistoricalChristianFaith/Commentaries-Database>
- Tauri+SQLite: <https://v2.tauri.app/plugin/sql/> · sqlite-vec: <https://github.com/asg017/sqlite-vec>

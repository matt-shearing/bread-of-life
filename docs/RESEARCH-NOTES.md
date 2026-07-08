# Bread of Life — Research Notes (Archaeology of Prior Attempts)

_Compiled 2026-07-09. Source: a systematic review of every prior Bible project in `~/dev`
(`bread-of-life`, `bread-of-life-25`, `bread-of-life-app`, `bread-of-life-catalyst`,
`BreadOfLife-Desktop-App-{main,old}`, `bible-data-{api,static,sword}`, `commentary-parser`)._

This is the "consider all of it first" document. The new brief (`PROJECT-BRIEF.md`) is built on
top of it. The point of this file is to make sure we never re-learn what these attempts already
taught us.

---

## 1. The thread — what Matt actually wanted (constant across every attempt)

The single most authentic artifact is `bread-of-life-app/Bread-of-Life-human-draft.md` — Matt's own
raw voice, before any AI planning layer. Everything else is downstream. Its thesis:

> "I want to build a new Bible app… designed for busy adults who want to have something that they
> can use as a **'homebase'** for all sorts of bible functionality."

**"Homebase" is the whole idea.** Not a Bible reader — a single, warm, integrated hub that replaces
the 4–5 apps a Christian currently juggles (a reader, a prayer list, a devotional, a journal, study
tools). The emotional core is the prayer log, and Matt speaks from personal frustration here:

> "having a prayer logging system … that: Works … Allows you to note down prayers and then mark when
> they are answered … Then lets you look back on prayers that were answered so you can see **what God
> has done for you**."

That last line is the heartbeat of the product. Note the first requirement is simply **"Works"** — he
has been let down by existing tools. Other constants from the draft:

- **Warm, inviting, snappy, self-contained, low-footprint, runs anywhere, offline-first.**
- **Rich cross-module integration** — a reference in a devotional deep-links into the Bible with a
  "back" button; right-click anything to push it to the journal or start a prayer.
- **Commentary that tracks your reading** (side-panel following your position; split-pane on big
  screens), and — crucially — **pluggable commentary**: bring in _any_ commentary via a standard
  schema, his flagship example being **his own Chuck-Missler-style chapter notes**.
- **BSB (Berean Standard Bible)** as the default translation; mine open-source apps (e.g. **And Bible**)
  for implementation ideas.
- Tech stack was **explicitly left open** ("Consider & make recommendation… Back it up with research").

## 2. Timeline of attempts

| Order | Folder | Date | Stack | High-water mark |
|---|---|---|---|---|
| 1 | `bread-of-life` | May 2025 | Tauri + Nuxt/Vue + PocketBase | Design system + dashboard; **mock data only** |
| 2 | `BreadOfLife-Desktop-App-{old,main}` | Jun 2025 | Tauri + Nuxt + PocketBase | Best **UI-guide + mockups**; 6 module shells, mock data; stuck on build stabilization |
| 3 | `bread-of-life-app` | Jul 4 2025 | Next.js + Convex + NextAuth | Scaffold only |
| 4 | `bread-of-life-catalyst` | Jul 6–10 2025 | Next.js + Convex + Clerk | **Working reader + highlights** (real text via bible-api.com); then post-mortem → "restart in Vue" |
| 5 | `bible-data-{api,static,sword}` | Jul 8 2025 | (worktrees of catalyst) | **Data bake-off: static JSON won (9.05/10)** |
| 6 | `bread-of-life-25` | Jul 10–26 2025 | Nuxt + Supabase (PWA) | **Furthest of all** — working BSB reader, Strong's, highlights, notes, prayers, journal, search |
| 7 | `commentary-parser` | Feb 2026 | Python + SQLite | **Most mature** — canonical verse-indexed commentary store from Matt's own audio+PDF corpus |

## 3. Why every attempt stalled (the cross-cutting failure patterns)

These are the assumptions the new build explicitly rejects.

1. **The meta-framework ate the product.** Every 2025 repo is smothered by "Cracked Jacked Claude"
   (CJC) — an agent-orchestration framework with a 30KB CLAUDE.md, "BEAST MODE" personas,
   Octopus/Squid protocols, TaskMaster, orchestrator MCP, specs-first + empirical-verification
   ceremony, GitLab distribution docs, `.roo/.cursor/.kiro/.trae/.windsurf/.clinerules`. In
   `bread-of-life/ai-docs/context/overview.md` the "mission" had even drifted to _"provide a
   comprehensive starter kit for Claude Code projects."_ **The tooling forgot it was a Bible app.**
   Process-about-process consumed most of the effort in every repo.

2. **Stack thrash + auth churn.** Nuxt/Tauri/PocketBase → Nuxt/Supabase PWA → Next/Convex/NextAuth →
   Next/Convex/Clerk → a written plan to restart in Vue/Supabase. Auth alone churned
   NextAuth→Convex Auth→Clerk, leaving `-no-auth`/`-clerk`/`.bak` files everywhere. No attempt ever
   finished a stack.

3. **Five competing state systems.** Catalyst's Bible page hit 722 lines, 15+ state vars, 7
   `useEffect`s, with useState + Context + Zustand + Convex + URL state all fighting. That was the
   root cause of the endless "make highlighting actually work" bug marathon.

4. **The SWORD rabbit hole.** Two attempts assumed CrossWire SWORD modules as the data engine. There
   is **no production-ready JS SWORD library**; modules are C++/compressed-binary, CORS-blocked,
   5–50MB each. Both attempts fell back to plain APIs anyway. Net: wasted cycles for zero shipped value.

5. **Mock data / never wired end-to-end.** The two desktop attempts (#1, #2) built six pretty module
   shells on **placeholder verses** and never connected a real data layer. Real scripture flowing
   end-to-end is the thing that most separates the attempts that felt real (#4, #6) from the ones
   that didn't.

6. **Redundant re-implementation.** `bread-of-life-25` had 4+ Bible reader components and 5+ Bible
   composables; its own #1 roadmap item ("adopt one reader, delete the rest") never completed.

7. **Scope balloon into a fake startup.** `bread-of-life-master-plan-updated.md` invented personas
   with fake quotes, a $9.99/$29.99 freemium model, "$1.2M ARR by year 3," a Product Hunt launch, a
   5-year roadmap ending in "AR/VR Bible experiences," "global prayer maps," "chiastic structure
   detection." None of it traces to Matt, who said he'd run beta on his own spare compute.

## 4. What genuinely worked — assets & ideas to carry forward

**Design (richest in `BreadOfLife-Desktop-App`'s `UI-guide.md` + `mockups/`):**
- Amber `#f59e0b` primary — the "Bread of Life" emotional signature; full 50–900 ramp, indigo secondary.
- **Inter for UI, Merriweather serif @18px for scripture only** — the single best reading decision;
  makes the Bible feel like a book, distinct from chrome.
- **Three-pane study workspace**: 256px left nav | center scripture | collapsible right "study tools"
  rail (search, notes, cross-refs, commentary that tracks your position).
- Per-verse hover actions (highlight/bookmark/note) with amber-50 highlight state.
- Dashboard as a warm "daily plan": Verse-of-the-Day hero, weekly streak row, continue-reading,
  Today's-Plan rail.
- Prayer module: category chips, "prayed N times", a dedicated **green "Recently Answered" rail**, and
  a stats grid (Active / Answered / Days Praying / Consistency %).
- Journal "Quick Add" rail (insert verse / prayer / devotional) — the cross-module connective tissue.

**Data & architecture learnings:**
- **Static JSON of public-domain translations beats everything** for an offline reader (bake-off:
  9.05/10; 10–20× faster than API; 100% offline; trivial). Pipeline: USFM/clean-JSON → per-book files.
- **Split immutable scripture (files) from mutable user data (a DB).** This architecture was the one
  thing multiple attempts agreed on and it's correct.
- **`bread-of-life-25` is the best code quarry**: `BSBService`/`USFMParser`, Strong's dataset (~8,600
  entries), a `CommentaryService` with a pluggable `commentary_sources` schema + three-tier cache, a
  mature RLS Supabase schema (highlights, prayers-with-answered-tracking, journal, reading progress,
  notifications, FTS), and a `[[John 3:16]]` reference-linking parser.
- **`commentary-parser` is the crown jewel of recent thinking.** It turns Matt's ~50GB of personal
  audio teaching + PDF study notes into a **canonical verse-indexed SQLite store** using **BBCCCVVV
  integer verse IDs + OSIS strings** (`book*1_000_000 + chapter*1_000 + verse`, `Gen.1.1`). It is
  explicitly designed as the _upstream feeder_ for a bespoke Bible app (its §14.5: "Personal Bible app:
  Custom-built app — optimize canonical SQLite database"). It already exports to Obsidian, markdown,
  and every major Bible-app format. **Its verse-identity scheme is the interop contract the new app
  should adopt**, and Matt's own commentary is the true, un-copyable differentiator.

## 5. The one-line conclusion

The real Bread of Life is a **warm, self-contained, offline-first desktop homebase** that fuses Bible
reading + pluggable commentary (including Matt's own) + devotionals + journalling + an **answered-prayer
log you can look back on** — tied together by universal capture and deep cross-module links. Every prior
attempt _knew_ this (the product plans were good) and then buried it under an agent-orchestration
meta-framework and a stack it never finished. **The new build's job is to delete the ceremony, pick one
stack, wire real data end-to-end first, and ship the emotional core.**

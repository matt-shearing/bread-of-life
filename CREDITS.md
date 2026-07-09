# Credits & data licensing

Bread of Life's code is MIT (see `LICENSE`). The scripture and study data it
bundles or fetches belong to their sources and are used under their own terms.
All bundled data is public domain or CC-BY; nothing copyright-restricted is
redistributed here.

## Bundled data (in this repo, offline)

| Data | Source | License |
|---|---|---|
| Berean Standard Bible (BSB) | berean.bible via the HelloAO Free Use Bible API | Public domain (CC0) |
| OT Hebrew interlinear + morphology (`public/data/strongs-heb`, `lexicon-heb.json`) | Open Scriptures Hebrew Bible (Westminster Leningrad Codex), openscriptures/morphhb | **CC BY 4.0** |
| Cross-references (`public/data/xref`) | OpenBible.info — derived from the Treasury of Scripture Knowledge | **CC BY 4.0** |
| NT Greek Strong's word tags + lexicon (`public/data/strongs`) | Strong's Concordance / BSB word tags | Public domain |
| Spurgeon, *Morning & Evening* (`spurgeon.json`) | Christian Classics Ethereal Library (CCEL) | Public domain |
| Spurgeon, *Faith's Checkbook* (`faiths-checkbook.json`) | CCEL | Public domain |
| Dashboard artwork (`public/backgrounds`) | Generated with Google's image model | Original artwork for this project |

Per **CC BY 4.0**, attribution is given above to the Open Scriptures Hebrew
Bible and OpenBible.info; no changes to those texts alter their meaning (they
were reformatted to JSON for the app).

## Fetched at runtime (only when online / opted in)

| Data | Source | Notes |
|---|---|---|
| Public-domain commentaries (Matthew Henry, JFB, Clarke, Gill, Keil-Delitzsch, Tyndale) | HelloAO Free Use Bible API | Public domain; cached locally after first view |
| Additional translations (WEB, KJV, ASV, YLT) | HelloAO Free Use Bible API | Public domain; cached locally |
| AI study companion | Anthropic / OpenAI / xAI / Google / DeepSeek / Ollama | Only when **you** add a key; requests go directly to your chosen provider |

## Software

React, Vite, Tailwind CSS, Radix UI, Dexie, Zustand, Tiptap, Tauri, lucide
icons — all under permissive licenses (MIT / ISC / Apache-2.0). Fonts: Inter and
Merriweather (SIL Open Font License).

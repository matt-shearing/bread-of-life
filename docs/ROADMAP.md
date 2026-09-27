# Roadmap

Bread of Life is at v0.4.0, with v0.5.0 built on `integrate/v0.5` and waiting for Matt's approval.
The biggest open item is deploying the v0.5 sync server, which is blocked because SSH to the
sync VM is closed at the host firewall. This page lists what has shipped, what comes next and what
we decided not to build. For how the project works day to day, see [`HANDOFF.md`](HANDOFF.md).

## Shipped

### v0.1 (July 2026)

- **v0.1.0:** the first public beta on Android and Linux. It had the Berean Standard Bible offline,
  highlights and notes, the answered-prayer log, the journal, the dashboard and the commentary rail.
- **v0.1.1:** Windows and macOS builds.

### v0.2.0 (July 2026)

- Optional cross-device sync through the hosted server or a self-hosted one.
- The *Soul Food* Bible-in-a-year plan.
- A fix for the blank screen on Linux caused by WebKit's DMABUF renderer.

### v0.3 (July–August 2026)

- **v0.3.0:** Memory Lane, the guided reading-plan mode, journal and prayer cross-links, first-run
  onboarding, custom prayer categories, swipe to turn the chapter, a resizable study rail and a
  collapsible sidebar, and an AppImage that uses the system WebKit.
- **v0.3.1:** reminders scheduled by the operating system, and layout fixes for the Pixel Fold and
  tablets.
- **v0.3.2:** the Faithfulness review, the Commentary page, end-to-end encryption of the journal,
  prayers and notes, the Missler Inspired commentary, and notifications that open the right page.
- **v0.3.3 to v0.3.6:** the audio Bible with background playback on Android through a native
  playlist, which carries on from chapter to chapter to the end of the Bible.
- **v0.3.7 to v0.3.9:** all-files access on Android as a Kotlin plugin, a folder picker for the
  Missler library, and Missler audio on the phone.
- **v0.3.10 and v0.3.11:** the reading plan and account preferences follow you between devices.
  v0.3.11 also added the release guard, because v0.3.10's release commit deleted the feature it
  announced.

### v0.4.0 (25 September 2026)

- Pausing and resuming from earphones no longer loses the sound on Android.
- A Now Playing page that follows the day's readings.
- Android Auto: today's reading, the whole Bible, the devotional, recent items and voice requests.
- Spurgeon's *Morning and Evening* read aloud from recorded MP3s, with the phone's own voice as a
  fallback.
- Daily-reading reminders at 2 pm and 8 pm that stop once you have read.

### v0.5.0 (pending approval)

Everything below is merged on `integrate/v0.5` and not yet released.

- **Backup and export.** Back up everything that syncs to one JSON file, restore it on any device
  (restoring merges and never deletes), and export the journal, prayers and notes as Markdown in a
  zip. Devices without sync get a monthly backup reminder.
- **Sync that no longer loses or leaks data.** A Dexie middleware now records every change in the
  same transaction as the write. Edits made during a sync, edits from a device with a fast clock,
  and plan days ticked on two devices all survive. Turning on encryption replaces the readable
  copies on the server, and a second device asks for the recovery phrase instead of making a second
  key. Device-only settings stay on the device, and journal HTML is sanitised before it is shown.
  The client works with the v0.4.0 server in production. The v0.5 server adds token expiry, sign
  out on all devices, password change, account deletion and per-row errors, but it is not deployed.
- **Finding and landing.** Every reference opens on its verse with a brief highlight and a "Back
  to…" bar. The Bible tab remembers the verse you were on, and reading a plan no longer moves it.
  Search understands typed references such as "jn 3:16" and searches your journal, prayers and
  notes. Ctrl+K opens a command palette, and the arrow keys turn chapters.
- **The unfolded Fold.** The sidebar starts collapsed and the study rail takes at most 40% of the
  width, so the text stays readable. Tapping a verse on a touch screen opens a sheet of labelled
  actions.
- **Journal and prayers.** Journal drafts save as you type and survive Escape, Android back and a
  closed app. Deleting an entry asks first and can be undone. Prayers can be edited, deleted and
  archived, with an Archived list to restore from. "Prayed" can be undone. A pray-through mode
  walks through today's prayers one at a time. Onboarding is a proper dialog with Back and Skip.
- **Reading history.** Every day a chapter is read is kept, so re-reading a chapter no longer
  breaks the streak. A History page shows a year's calendar, streaks and progress by book. The
  dashboard has an "On this day" card for prayers answered and entries written on this date in
  earlier years.
- **Faithfulness review.** It filters by year and month, shows the verses and journal entries
  linked to each prayer, has a month-by-month bar of answered prayers, and offers Share or Copy
  text on Android.
- **One look across the app.** Shared page headers, tabs, chips and switches; one Today card on the
  dashboard; a section index in Settings; one commentary view for the page and the rail; one list
  of pages for the sidebar, the bottom bar and the palette; darker, more legible colours; 44 px touch
  targets, labelled inputs, a skip link and visible focus.
- **Sleep timer.** Now Playing can stop the narration after a set time, at the end of the chapter or
  at the end of the day's reading. The sound fades over about ten seconds and pauses. Android Auto
  has a moon button for it.
- **Audio fixes.** Native playback reports its position twice a second instead of forty times, and
  not at all while the app is hidden. Play works after a network error. Closing the mini-player
  stops the audio. Navigation prompts in the car pause the narration instead of talking over it.
  On Linux, skipping chapters no longer queues downloads, the sound device is released when idle,
  a bad seek cannot crash the app, and media keys work through MPRIS.
- **Security.** A Content Security Policy, capabilities split by platform, and plain `http://`
  limited to the local network.
- **Engineering.** Pages load on demand, which halves the JavaScript loaded at start-up. Strong's
  lookups fetch about 100 kB instead of 1.3 MB. Only Latin font subsets ship. CI runs typecheck,
  lint, tests and a build on every pull request. `pnpm-workspace.yaml`, which holds the three-day
  dependency cooldown, is committed. Devotional completions record the year, and the verse of the
  day changes at local midnight.

## Next

### Waiting on the server

- **Deploy the v0.5 sync server.** SSH to `bol-sync-01` times out at the host firewall, even from
  the same subnet, so the fix needs the OpenStack noVNC console. Before deploying, confirm that the
  VM's `.env` sets `TOKEN_SECRET`, because the new server refuses to start without it. If the
  server sits behind Cloudflare, set `TRUSTED_PROXIES` too. Account deletion, which Google Play
  requires for apps with accounts, only appears after this deploy.
- **Reading-history sync.** The `readingLog` table syncs only to a server that advertises the
  `readingLog` feature. Until the deploy, each device keeps its own history, and nothing fails.

### Needs Matt's phone

- A home-screen widget with the verse of the day, today's plan and a Pray button.
- Sharing text from another app into a new prayer or journal entry.
- Downloading Bible audio for offline listening.
- Share images for verses and answered prayers.
- Notification actions: "Mark done" on the devotional reminder, and "Listen now" on reading
  reminders.
- A PDF of the Faithfulness review on Android. `window.print()` is probably ignored by the Android
  WebView, so the phone offers Share and Copy text for now.
- A reminder time for each prayer.
- Confirming that prayer, memory and devotional reminders arrive while the app is closed.
- Checking the v0.5 work on the Fold and the Linux desktop: backup and restore through the system
  file picker, the audio fixes, the sleep timer with the screen locked, and the Android back gesture.

### Code work

- **Media3 1.6 or later**, from 1.4.1, with `compileSdk` raised from 34. Run the Robolectric suite
  and test on the phone.
- **Keys in localStorage.** The E2E data key and the AI provider key are stored in plain text in
  localStorage (review item S8). Move them to the OS keystore.
- **Prayer counts merge as whole rows.** `prayedCount` and array-valued settings still take the
  newer row whole, so prayers counted on two devices while offline lose one side. Merge them per
  field, as plan progress now does.
- **Faith's Checkbook read aloud.** Only *Morning and Evening* has recordings. The phone-voice
  fallback already exists.
- **Duplicate reading-log days after an Android freeze.** A chapter that finishes while Android has
  the app frozen can be logged on two days, because the in-app callback logs the time the app wakes.
- A plans calendar view, a page listing every highlight and note, and a wider range of text sizes.
- `react-router` 7, which clears the last two `pnpm audit` advisories.

### Larger pieces

- **Red-letter words of Jesus.** The Berean Standard Bible data has no markup for them, so this
  needs a separate data source.
- **Local AI search** over scripture, commentary and your own notes, with `sqlite-vec`.
- **Move to breadoflife.app.** Move the website and the sync server to `sync.breadoflife.app`, keep
  breadoflife.dev redirecting, and make the sync URL configurable without a rebuild.
- **Signing.** A Developer ID certificate and notarisation for macOS, then iOS through TestFlight on
  the same Apple account. Windows signing is optional.

### Later

- The SQLite swap for user data. It is deferred because IndexedDB already works offline in every
  webview, and a SQLite backend cannot run in the browser test loop. Revisit it with local AI search.
- Matt's own commentary corpus from `~/dev/commentary-parser` as a commentary source.
- Licensed translations (NASB, Amplified) through API.Bible behind the user's own key.
- *The Word for Today*, built on `feat/word-for-today` and held until UCB grants written permission
  (see [`WORD-FOR-TODAY.md`](WORD-FOR-TODAY.md)).

## Decided against

- **Evolu for sync.** Evolu needs OPFS, and WebKitGTK does not implement the OPFS sync access
  handle, so it cannot save data in the Linux desktop app. Sync uses Dexie with our own delta sync
  instead.
- **Dexie Cloud.** Self-hosting it needs a paid commercial licence, which rules out a free
  self-hosted server.
- **CouchDB and PouchDB.** They would replace Dexie for an older sync model, a bigger rewrite than
  the problem needs.
- **Social features** such as a prayer wall or shared reading plans. The app is a private place for
  one person's devotional life.
- **A cross-reference graph.** It is busy to look at and adds little to daily reading.
- **Audio speed per source.** One speed already carries across the queue and into the car.
- **Importing from other Bible apps.** They have no stable export formats.

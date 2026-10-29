# systema

One offline-first PWA that runs your travel workflow — before, during and after
a trip — so you can offload memory and admin and stay present. Hold the
itinerary you generated in Claude, read it and tick it off offline, and log
expenses with almost no friction into a format that matches your sheet.

**Single app, not a suite. No marginal cost beyond an existing Claude
subscription.**

- **Two core jobs:** (1) frictionless expense capture into your sheet's format;
  (2) hold the itinerary so you can read it, tick things off and add photos,
  fully offline.
- **Offline-first installable PWA** — iPhone first, also fine on desktop.
- **Local-first** — IndexedDB is the source of truth on the device.
- **Static front end, hosted free** — no application server.
- **Bring-your-own-Claude** — the AI handoff is plain text in / plain text out,
  done in your own Claude subscription. The app calls **no** paid API.
- **No application server** — the app is the ledger. Expenses live in IndexedDB
  and export to CSV in your master sheet's column format when you reconcile.
  Optional: sync and backup through a Synology NAS you host (a token-gated PHP
  receiver) — the iPhone and the Mac stay in step; no third-party accounts, no
  API keys.

## Stack

| Concern       | Choice                                                   |
| ------------- | -------------------------------------------------------- |
| Framework     | Svelte 5 (runes)                                         |
| Build / dev   | Vite                                                     |
| Language      | TypeScript                                               |
| PWA / offline | `vite-plugin-pwa` (Workbox)                              |
| Local store   | Dexie.js over IndexedDB                                  |
| Plan render   | `marked` + `DOMPurify` (offline Markdown, sanitised)     |
| Routing       | Tiny hash router (no server rewrites; offline-safe)      |
| FX            | Frankfurter (ECB, no key), cached locally (Phase 2)      |
| Backup / sync | Self-hosted NAS (3-way merge) + ZIP backup files         |
| Tests         | Vitest (unit) + Playwright (Chromium + WebKit e2e)       |
| Styling       | Hand-rolled CSS design tokens                            |
| Host          | GitHub Pages (Cloudflare Pages is a drop-in alternative) |

## App shape

- **Home** — current trips up top; trips marked Done shelve into a **Trip
  journal** section (everything kept: plan, stops, notes, photos, expenses,
  journal). Each card names itself from its legs (e.g. `Barcelona → Bologna`);
  a trip about to move shows its next leave-by time. Covers: a single city's
  route sketch, a photo, or — for a multi-city trip — a journey card (cities,
  dates, rhythm); your choice per trip.
- **Insights** (`#/insights`) — decisions, not charts: what a day on the
  ground, food, an airport transfer (per person) or a place visited cost in
  each city — one question at a time, from each leg's real hours and each
  expense's own city, every figure with its sample size and nothing called
  "best" — plus airport-transfer notes, each trip's rhythm against its plan,
  per-category and per-trip totals, and what the numbers rest on (trip-wide
  spend kept apart, never split; unlinked and unpriced rows disclosed). An
  all-trips CSV exports in the master-sheet column format; the Google sheet is
  updated by pasting CSV when reconciling, not by a live service.
- **History import** — `scripts/import-travel-spending.mjs` converts a dump of
  the legacy Travel Spending sheet into a backup file the app imports (trips,
  cities with currencies, expenses, and visited stops inferred from ticket
  purchases). Generated files contain personal data — never commit them.
- A trip is described by its **legs** — each city with its arrival and
  departure (as printed on the tickets, in that city's own time zone), where you
  slept (nothing / airport / hotel), an optional hotel/base, and how you leave
  (airport or station, terminal, flight number, booking reference, how you get
  there and how long it takes, how early you want to be there). Leaving home is
  a departure too. From those the app derives the trip's shape (same-day dash,
  airport sleep, city break, multi-city, **two-city stopover** 1–4…), dates and
  name — so nothing has to be kept in sync by hand. A departure before its own
  arrival is refused, with how to fix it; other timing clashes are explained.
- **Two-City Stopover** is a starting point (New trip): pick one of the four
  scenarios from the flight finder, name the stopover and the destination, and
  the legs, the hotel night and the protected hop are laid out; drift from the
  pattern (land by ~11:00, hop after ~18:00 or before ~10:00, home after
  ~18:00) is noted, never blocked.
- Inside a trip, four tabs only:
  1. **Plan** — your pasted itinerary, rendered and readable offline, with an
     auto contents list and, at the top, a calm **Next departure** card: the
     next airport or station departure not yet gone (not the final flight
     home), `leave by = departure − buffer − journey − spare`, in plain words
     and stages (Later · Prepare · Leave by · Time to go · Plan B), refreshed
     once a minute — no ticking clock. Adjust changes the plan in a few taps;
     Calendar reminders saves an .ics with a "get ready" and a "leave now"
     alert per departure. A **Research prompt** builder pre-fills copy-ready
     Claude prompts — for a multi-city trip **one city at a time** (Research
     Bologna, Paste Bologna plan, then Barcelona), each with only that city's
     hours, base and transfers — in a format the app imports automatically.
     Two modes: _plan a new route_, or _I already have the plan_. Once a
     journal is saved, the tab grows a Plan | Journal toggle.
  2. **Stops** — an ordered, tickable list of places grouped by city, with
     notes, discovery checklists, photos and, for major sites, a **visit
     anchor** (where to begin, the 10–20 minute version, three things to look
     for, a stretch, what can be skipped), plus off-plan moments in their
     city. **List | Map**: one city at a time (numbered within the city, a
     walking line only inside it) or a labelled Transfers overview; drag to
     adjust, tap to place; tiles cached for offline. One tap **extracts stops —
     with notes, anchors, checklist items and map pins — from the plan**.
  3. **Expenses** — capture is an amount and one tap: quick picks (recent and
     templates) set the category; city, currency, date, destination and
     payment default from the leg you're in; the rest is under More details.
     Trip-wide spend is an explicit choice. A likely double entry is flagged.
     Non-GBP amounts save with no £ needed and **price themselves from the
     day's ECB rate** when online; a £ typed by hand is never re-priced.
  - **What happened?** (the spark in a trip's header) keeps something off the
    plan in seconds — a place found by accident, a changed plan, a missed bus,
    an encounter — with photos from the camera or the library.
  4. **Export** — journaling prompt prefilled with the trip pack (visit order,
     unplanned moments, a numbered photo list with stable references to attach
     in order; photo
     placeholders included), a **reconstruction prompt** for pre-app trips
     (expense trail as memory scaffold), journal paste-back and per-trip CSV.
- **Settings** (gear on Home) — backup health (last sync, changes not yet on
  the NAS, photos uploaded, last backup file), Sync now, Check NAS copy, full
  backup download (.zip), restore from a file (checked and previewed first,
  optionally filling blank fields on records already here),
  edits made on two devices to review, NAS sync setup, storage/install status.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173 (service worker enabled)
```

Other scripts:

```bash
npm run check        # svelte-check + tsc type-checking
npm run test         # unit tests (Vitest)
npm run test:e2e     # Playwright smoke (run `npx playwright install` once)
npm run build        # production build -> dist/ (manifest + service worker)
npm run preview      # serve the production build locally
npm run format       # Prettier
npm run lint         # ESLint
```

## Testing

`npm run test` (Vitest) covers the pure logic: zone maths across clock
changes, leave-by and stages, .ics output, chronology, the two-city scenarios,
per-city prompts, plan blocks, anchors, the visit timeline, journal photo
references, quick-capture defaults and duplicates, CSV round trip, insights,
NAS failure classes, EXIF — and that a snapshot from this version still passes
the **previous version's** validator and merge (frozen in
`tests/unit/fixtures`).

`npm run test:e2e` (Playwright) runs every flow on Chromium **and on WebKit
with an iPhone profile** (the iPhone's engine): Back and scroll restore, the
fixed shell (the document never scrolls, the bars never move), double-tap
policy, the expense `<dialog>` in the top layer, copying inside the tap and
the fallback sheet, itinerary zones and refusals, city-local maps and covers,
moments and library imports, quick capture and the CSV, a v3 → v4 database
upgrade, and NAS sync, partial backups, retries and diagnostics against a fake
receiver — plus the real PHP receiver (current, previous and original) in CI.

### On the iPhone (what emulation can't show)

After a deploy, on the installed app (Add to Home Screen):

1. Scroll a long Stops list hard, both ways: the top bar and tab bar stay
   exactly put; no rubber-band of the whole page.
2. Double-tap a chip, a keypad key and the gap between buttons: no zoom.
   Pinch still zooms.
3. Add an expense; type in Description and close the keyboard: Cancel/Save
   stay at the top, and the page is back in place after the keyboard goes.
4. Research prompt → Research a city: "copied" appears; paste in Claude. (If
   it ever refuses, a sheet shows the text to copy or share.)
5. Open a stop from far down the list, then the header's ‹ Stops: same place.
6. Next departure → Calendar reminders: the .ics opens with "Add All" (or use
   Share… → Calendar/Files).
7. What happened? → Choose from library → pick several: they appear in the
   order taken. Export → Share the photos for Claude: the share sheet lists
   them numbered.
8. Settings → Backup → Test connection on home wifi and away: each line says
   what it found.

## Hosting

GitHub Pages serves a project site from `/<repo>/`, so the production build uses
`base: '/systema/'` (see [`vite.config.ts`](vite.config.ts)). The
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) workflow builds
and publishes on every push to `main`.

If you deploy to a custom domain, a user/organisation page, or Cloudflare Pages,
change `prodBase` to `'/'` in `vite.config.ts`.

## Deploy

Live at **https://ethan-ghoreishi.github.io/systema/**. The
[workflow](.github/workflows/deploy.yml) builds and deploys on every push to
`main` — just `git push`.

Hosting notes:

- GitHub Pages is free for **public** repos. On the Free plan a **private** repo
  can't use Pages — either keep it public (this repo has no secrets; the NAS
  URL/token live only on-device) or host the private repo on **Cloudflare Pages**
  (also free, the brief's named alternative).
- If the repo name isn't `systema`, set `prodBase` in `vite.config.ts` to
  `/<repo>/` so the Pages base path matches.

## Project structure

```
src/
  app.css                  Design tokens + base styles
  App.svelte               Shell + hash routing
  main.ts                  Mounts the app
  components/
    AppShell.svelte        Outer frame (centred, full height)
    TopBar.svelte          Per-screen top bar
    Icon.svelte            Inline icon set
    Keypad.svelte          Numeric keypad
    ExpenseCapture.svelte  Quick expense capture (native <dialog>)
    CopySheet.svelte       Text the clipboard refused, to copy or share by hand
    NextDeparture.svelte   The calm leave-by card
    DepartureEditor.svelte A departure's plan (native <dialog>)
    MomentCapture.svelte   "What happened?" (native <dialog>)
    PastePlanDialog.svelte Paste one city's plan
    PhotoPicker.svelte     Take photo / Choose from library
    UpdateToast.svelte     Update / offline-ready toast
    TripCover.svelte       Trip cover (route sketch / photo / ribbon)
    CoverPicker.svelte     Choose/upload a trip's cover
    tabs/                  PlanTab, StopsTab, ExpensesTab, ExportTab
  routes/
    Home.svelte            Trip list + new trip
    NewTrip.svelte         Starting-point (template) picker
    Trip.svelte            Four-tab trip frame
    TripEdit.svelte        Legs editor + details + cover
    Settings.svelte        Backup health, restore, conflicts, NAS setup, storage
    NotFound.svelte
  lib/
    db.ts                  Dexie schema (Trip/City/Stop/Expense/Photo)
    router.svelte.ts       Reactive hash router
    connectivity.svelte.ts Online/offline state
    settings.ts            Settings model (pure, testable)
    settings.svelte.ts     Settings store (IndexedDB-backed)
    trips.ts               Trip + leg mutations, derived-field sync
    trip-shape.ts          Pure: name/shape/dates/nights from legs
    presets.ts             Starting-point templates (plain data)
    cover.ts               Pure SVG cover generators (sketch/ribbon)
    markdown.ts            Plan rendering (marked + DOMPurify)
    headings.ts            Pure heading parsing (contents list + split helper)
    tz.ts                  Pure: zoned wall clock ↔ instant (Intl), zone suggestions
    readiness.ts           Pure: leave-by, stages, next departure, .ics reminders
    moments.ts             Off-plan moments + the visit timeline
    exif.ts                Pure: a JPEG's capture time
    expense-defaults.ts    Pure: quick picks, defaults, trip-wide, duplicates
    nas-diagnostics.ts     Pure: failure classes, explanations, backoff, redaction
    copy.svelte.ts         Copy inside the tap, with a selectable fallback sheet
    ui-memory.ts           Per-screen scroll/view memory (session only)
    viewport.ts            On-screen keyboard handling, apart from layout
    currencies.ts          Currency suggestions
    format.ts              Pure helpers
    ids.ts                 UUID helper
    expenses.ts            Expense mutations + summaries
    sheet.ts               Travel Spending row formatting
    money.ts               Currency display helpers
    vocab.ts               Expense controlled vocabularies
    fx.ts                  Frankfurter FX + local cache
    stops.ts               Stop + checklist mutations, plan extraction
    photos.ts              Photo blobs (add / delete / download)
    prompt.ts              Research-prompt builder (pure text assembly)
    export.ts              Trip pack, ZIP backup, add-only restore (+ dry run)
    zip.ts                 Minimal store-only ZIP (CRC-checked, ZIP64 when needed)
    sync.ts                Pure three-way merge for device-to-device sync
    conflicts.ts           Edits made on two devices: list + resolve
    backup-validation.ts   Backup/snapshot shape checks before any write
    nas.svelte.ts          NAS sync (photos first, merge, push), health, check
    download.ts            Clipboard + file download helpers
nas/systema-backup.php     Token-gated NAS receiver (self-hosted)
docs/nas-backup-setup.md   Synology setup + Tailscale/CGNAT notes
tests/
  unit/                    Vitest
  unit/fixtures/            The previous version's validator and merge (frozen)
  e2e/                     Playwright, Chromium + WebKit (iPhone profile): app
                           flows, layout, sync (fake NAS + real PHP), backups,
                           data safety, the v3 → v4 upgrade
  pwa/                     Update-while-editing test on two production builds
```

## Security & cost guarantees

- The app is the ledger. Your data lives in IndexedDB on the device and exports
  to CSV (per-trip or all-trips) in the master-sheet column format when you
  reconcile. **No trip data is sent anywhere** except the NAS you host. Two
  third parties are contacted, neither with anything of yours: `frankfurter.dev`
  for the day's ECB rate (it is told a currency pair) and
  `tile.openstreetmap.org` for map tiles on the Stops map (it is told which map
  squares you look at, which implies the city). The app calls no AI API.
- The app stores only the NAS receiver URL and its token, on this device. No
  other secrets, no accounts, no API keys.
- **Sync between devices (iPhone + Mac):** each device syncs through the NAS
  and keeps the last few snapshots it agreed on, so changes merge three ways
  instead of "last device wins": edits to different things combine; the same
  thing edited on both keeps the newer edit and lists the other in Settings to
  choose from; a deletion applies unless the other device edited the record.
  Clearing a field is an edit like any other — never an empty space for the
  other device's old text to flow back into.
  Two devices pushing at the same moment would otherwise leave the NAS with a
  newest snapshot that is missing one of them: each push says which snapshot
  it was merged from, and the receiver (version 3) refuses one that has been
  overtaken (nothing written), so that device merges what landed and sends
  that instead. Against
  an older receiver the fork can still happen, and the merge then falls back to
  the newest snapshot both devices really share, so an edit one had already
  pushed is not undone; past even that, the difference is listed to review
  rather than applied quietly, and nothing is deleted. Each snapshot also
  carries a count of how much of each device's work it holds, so a device
  returning after months away is still known to be behind rather than ahead:
  what was deleted while it was gone stays deleted.
  Each photo uploads on its own and counts as backed up only once its size and
  SHA-256 are verified; one that keeps failing is listed with its reason and
  retried with a growing wait, while the data and every other photo still back
  up (an explicit partial-success state). Photos never leave because a
  snapshot lacks them (only an explicit delete does), and download one at a
  time. A new, reset or empty device merges before it pushes, so it can't
  replace the NAS copy; an idle sync writes and pushes nothing. A device still
  on the previous version keeps syncing safely: every new field is optional,
  and a snapshot without the newer tables deletes nothing.
- **Backup files:** Settings → Download full backup gives a ZIP — the data
  plus every photo as a normal image file — built one photo at a time, so the
  size of the library doesn't decide whether it works (ZIP64 past 4 GB), and a
  photo the device momentarily can't read is retried instead of failing the
  whole backup. Restore checks every checksum and shows what would be added before
  writing; it only ever adds what the device lacks. Older .json backups and NAS
  snapshot files restore too (a snapshot's photos are fetched from the NAS).
  One opt-in box, off by default, also fills fields a record here has left
  **blank** (an empty journal, say) from the backup — never over anything
  already written, so no information can be displaced; the preview counts them.
- **Test connection** tells apart the address, no connection, a CORS block, a
  refused token and an upload size limit. **Check NAS copy** verifies the NAS
  snapshot and that every photo it lists is on the NAS at the right size, names
  the missing ones, and queues any this device holds to upload again. The token
  is sent in a request header, not in the URL, so it stays out of the NAS's
  access log (a receiver older than version 3 only reads it from the URL — the
  app notices, falls back, and re-tries the header once a day so updating the
  receiver is enough to stop it); it never appears in a message, a stored
  diagnostic or a backup, and the Settings field keeps it hidden until you
  tap Show. The receiver's folder sits in the web root, so it also writes a
  deny rule and a blank index into it — on nginx (Web Station's default) add
  the one-line rule in the setup guide, or the snapshots are downloadable
  without the token by anyone who can reach the web server. See
  [`docs/nas-backup-setup.md`](docs/nas-backup-setup.md).
- No paid hosting, no metered AI, no paid backend. If a feature would need
  ongoing payment, it isn't built — a free alternative is used or it's flagged.

## Build phases

- [x] **Phase 0** — scaffold, installable PWA shell, design tokens, Settings, CI.
- [x] **Phase 1** — data model, Home + create-by-preset, four-tab trip frame,
      Plan tab (Markdown render + auto contents list + departure countdown).
- [x] **Phase 2** — Expenses tab (keypad, dependent chips, FX cache, per-person
      helper, skeleton rows, running total + per-category summary). Non-GBP rows
      price themselves from the day's ECB rate when online.
- [x] **Phase 3** — Stops tab (ordered tickable list, notes, checklist, local
      photos, reorder) + deterministic "split plan by headings".
- [x] **Phase 4** — Export tab (trip-pack Markdown + prefilled journaling prompt;
      full JSON backup and import for device transfer).
- [x] **Phase 5** — PWA polish: prompt-style update + offline-ready toast,
      precache + FX runtime cache, persistent-storage request, install flow.

**All phases complete.** See [Deploy](#deploy) to publish.

## Parked (future options)

Strict JSON itinerary import, an accreting lens library, a configurable template
engine, AI-assisted candidate sorting, logistics beyond the countdown, journal
import, and photo-to-lens tagging. Deliberately not built — kept simple.

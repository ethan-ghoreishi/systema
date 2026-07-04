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
  Optional: opportunistic backup to a Synology NAS you host (a token-gated PHP
  receiver); no third-party accounts, no API keys.

## Stack

| Concern       | Choice                                                    |
| ------------- | --------------------------------------------------------- |
| Framework     | Svelte 5 (runes)                                          |
| Build / dev   | Vite                                                      |
| Language      | TypeScript                                                |
| PWA / offline | `vite-plugin-pwa` (Workbox)                               |
| Local store   | Dexie.js over IndexedDB                                   |
| Plan render   | `marked` + `DOMPurify` (offline Markdown, sanitised)      |
| Routing       | Tiny hash router (no server rewrites; offline-safe)       |
| FX            | Frankfurter (ECB, no key), cached locally (Phase 2)       |
| Backup        | Optional opportunistic push to a self-hosted Synology NAS |
| Tests         | Vitest (unit) + Playwright (e2e smoke)                    |
| Styling       | Hand-rolled CSS design tokens                             |
| Host          | GitHub Pages (Cloudflare Pages is a drop-in alternative)  |

## App shape

- **Home** — current trips up top; trips marked Done shelve into a **Trip
  journal** section with cover photos (everything kept: plan, stops, notes,
  photos, expenses, journal).
- **Insights** (`#/insights`) — the whole ledger at a glance: every trip, every
  pound, per-category bars, per-trip totals, plus an all-trips CSV export in
  the master-sheet column format. The app is the source of truth; the Google
  sheet is updated by pasting CSV when reconciling, not by a live service.
- **History import** — `scripts/import-travel-spending.mjs` converts a dump of
  the legacy Travel Spending sheet into a backup file the app imports (trips,
  cities with currencies, expenses, and visited stops inferred from ticket
  purchases). Generated files contain personal data — never commit them.
- Inside a trip, four tabs only:
  1. **Plan** — your pasted itinerary, rendered and readable offline, with an
     auto contents list and a departure-time countdown at the top. A
     **Research prompt** builder pre-fills a copy-ready Claude prompt from the
     trip's details and asks for a route format the app imports automatically.
     Once a journal is saved, the tab grows a Plan | Journal toggle.
  2. **Stops** — an ordered, tickable list of places with notes, discovery
     checklists and photos, plus a **List | Map toggle**: OpenStreetMap route
     map (numbered pins, walking order line, drag to adjust, tap to place;
     tiles cached for offline). One tap **extracts stops — with notes,
     checklist items and map pins — from the pasted plan** (deterministic
     parsing, deduped, re-runnable).
  3. **Expenses** — two-tap capture and a running total. Non-GBP amounts save
     instantly with no £ needed and **price themselves from the day's ECB rate**
     when online.
  4. **Export** — journaling prompt prefilled with the trip pack (photo
     placeholders included), a **reconstruction prompt** for pre-app trips
     (expense trail as memory scaffold), journal paste-back, per-trip CSV, and
     full JSON backup/import.
- **Settings** (gear on Home) — NAS backup receiver URL/token, on-device data
  (restore / import / paste / download), and storage/install status.

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
    ExpenseCapture.svelte  Two-tap expense capture modal
    UpdateToast.svelte     Update / offline-ready toast
    tabs/                  PlanTab, StopsTab, ExpensesTab, ExportTab
  routes/
    Home.svelte            Trip list + new trip
    NewTrip.svelte         Trip-type preset picker
    Trip.svelte            Four-tab trip frame
    TripEdit.svelte        Trip + city editing
    Settings.svelte        NAS backup + on-device data + storage/install
    NotFound.svelte
  lib/
    db.ts                  Dexie schema (Trip/City/Stop/Expense/Photo)
    router.svelte.ts       Reactive hash router
    connectivity.svelte.ts Online/offline state
    settings.ts            Settings model (pure, testable)
    settings.svelte.ts     Settings store (IndexedDB-backed)
    trips.ts               Trip + city mutations
    presets.ts             Trip-type presets (plain data)
    markdown.ts            Plan rendering (marked + DOMPurify)
    headings.ts            Pure heading parsing (contents list + split helper)
    countdown.ts           Pure departure-countdown maths
    currencies.ts          Currency suggestions
    format.ts              Pure helpers
    ids.ts                 UUID helper
    expenses.ts            Expense mutations + summaries
    sheet.ts               Travel Spending row formatting
    money.ts               Currency display helpers
    vocab.ts               Expense controlled vocabularies
    fx.ts                  Frankfurter FX + local cache
    stops.ts               Stop + checklist mutations, plan extraction
    photos.ts              Photo blobs (add / delete / offload)
    prompt.ts              Research-prompt builder (pure text assembly)
    export.ts              Trip pack + JSON backup/import
    nas.svelte.ts          NAS backup vault (push snapshots/photos, restore)
    download.ts            Clipboard + file download helpers
nas/systema-backup.php     Token-gated NAS receiver (self-hosted)
docs/nas-backup-setup.md   Synology setup + Tailscale/CGNAT notes
tests/
  unit/                    Vitest
  e2e/                     Playwright
```

## Security & cost guarantees

- The app is the ledger. Your data lives in IndexedDB on the device and exports
  to CSV (per-trip or all-trips) in the master-sheet column format when you
  reconcile. Nothing is sent to a third party.
- The app stores only the NAS receiver URL and its token, on this device. No
  other secrets, no accounts, no API keys.
- **Moving between devices:** Restore from NAS (below), or carry a trip across
  via **Export → JSON** (backup + import). Imports merge by id — safe to re-run.
- **NAS backup vault:** optional, opportunistic push of data snapshots and
  photos to a Synology at home — token-gated PHP receiver that writes only into
  its own folder. Any device can also **Restore from NAS** (Settings → Data):
  newest snapshot plus missing photos, so a fresh install picks everything up.
  File-import and clipboard-paste restores work with no NAS setup at all. See
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
      photos with offload, reorder) + deterministic "split plan by headings".
- [x] **Phase 4** — Export tab (trip-pack Markdown + prefilled journaling prompt;
      full JSON backup and import for device transfer).
- [x] **Phase 5** — PWA polish: prompt-style update + offline-ready toast,
      precache + FX runtime cache, persistent-storage request, install flow.

**All phases complete.** See [Deploy](#deploy) to publish.

## Parked (future options)

Strict JSON itinerary import, an accreting lens library, a configurable template
engine, AI-assisted candidate sorting, logistics beyond the countdown, journal
import, and photo-to-lens tagging. Deliberately not built — kept simple.

---
id: install-work-offline-and-update
createdAt: 2026-11-09T14:20:02.154Z
status: works
presentation:
  title: Install, work offline and update
  journey: Travel
  order: 11
truth:
  goal: Use the cached app and receive updates without reloading during expense
    entry.
  startsWhen: The traveller opens the hosted app or its installed PWA.
  needs:
    - An initial successful online load; installation and persistent storage
      support depend on the browser.
  steps:
    - actor: Systema
      action: Register the service worker, cache the app shell and request persistent
        storage where supported.
      shows: Ready to work offline appears when caching completes.
      changes: Cached app resources are stored separately from IndexedDB records.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:02:46.566Z
        commit: d9be43941d6c9af1d77b821d13d1c67f2a23661e
    - actor: Traveller
      action: Install through supported browser controls or open the cached app
        offline.
      shows: Saved trips remain available; fresh rates, uncached tiles and NAS sync
        need a connection.
      changes: Ordinary edits continue locally.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:02:46.566Z
        commit: d9be43941d6c9af1d77b821d13d1c67f2a23661e
    - actor: Systema
      action: Check for updates on focus and periodically; defer a requested reload
        until Home with no open dialog.
      shows: The existing document remains during entry; returning Home permits the
        new build to load.
      changes: App resources update without clearing IndexedDB.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:02:46.566Z
        commit: d9be43941d6c9af1d77b821d13d1c67f2a23661e
  endsWith: The cached app works offline and an update can load at its guarded
    reload point.
  variations: []
  rules: []
  involves: []
mechanics:
  touchpoints:
    - src/App.svelte
    - src/components/UpdateToast.svelte
    - src/routes/Settings.svelte
    - src/lib/router.svelte.ts
    - src/lib/db.ts
    - vite.config.ts
  routes:
    - "#/"
    - "#/settings"
  components:
    - src/App.svelte
    - src/components/UpdateToast.svelte
    - src/routes/Settings.svelte
  entities:
    - Trip
    - City
    - Expense
    - Stop
    - Moment
    - Photo
  tests:
    - file: tests/pwa/update.spec.ts
      steps: []
    - file: tests/e2e/smoke.spec.ts
      steps: []
approval:
  hash: c19684d73f3b68b02b70ce23725039ee20afe80e7551a0649b4457513eb8c9fc
  at: 2026-11-09T14:29:10.936Z
  by: owner
  signature: Nt39Es2ZobaBSVHBi++1G7hT7yh/2X7xOnk6ZdMmH6r1CaGK6hbwCQsANXgGXJjX5tYAEytYklayhe0U7UUABw==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Install, work offline and update

_Works now · approved 2026-11-09T14:29:10.936Z by owner (signed)_

## Goal

Use the cached app and receive updates without reloading during expense entry.

## Starts when

The traveller opens the hosted app or its installed PWA.

## Needs first

- An initial successful online load; installation and persistent storage support depend on the browser.

## Steps

1. **Systema** Register the service worker, cache the app shell and request persistent storage where supported.
   - Shows: Ready to work offline appears when caching completes.
   - Changes: Cached app resources are stored separately from IndexedDB records.

2. **Traveller** Install through supported browser controls or open the cached app offline.
   - Shows: Saved trips remain available; fresh rates, uncached tiles and NAS sync need a connection.
   - Changes: Ordinary edits continue locally.

3. **Systema** Check for updates on focus and periodically; defer a requested reload until Home with no open dialog.
   - Shows: The existing document remains during entry; returning Home permits the new build to load.
   - Changes: App resources update without clearing IndexedDB.

## Ends with

The cached app works offline and an update can load at its guarded reload point.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_

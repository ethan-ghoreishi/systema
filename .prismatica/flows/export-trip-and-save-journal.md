---
id: export-trip-and-save-journal
createdAt: 2026-11-09T14:20:02.154Z
status: works
presentation:
  title: Export a trip and save its journal
  journey: Travel
  order: 7
truth:
  goal: Take records out of Systema and keep a finished journal with the trip.
  startsWhen: The traveller opens the Export tab.
  needs: []
  steps:
    - actor: Traveller
      action: Download the trip pack, expense CSV or numbered photographs, or copy a
        journaling prompt.
      shows: Portable files or a copy or share fallback are offered.
      changes: Source records stay on the device.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:02:18.467Z
        commit: 9a9c14c9e3e85cf5878e450fa2be786cd068fea8
    - actor: Traveller
      action: Write a journal externally, paste it and save.
      shows: Success or failure is reported; clearing a saved journal asks for
        confirmation.
      changes: Journal text is stored on the trip.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:02:18.467Z
        commit: 9a9c14c9e3e85cf5878e450fa2be786cd068fea8
    - actor: Traveller
      action: Open Journal on the Plan tab.
      shows: Rendered journal, matched photographs, remaining gallery and available
        route pins appear.
      changes: Completed trips with a journal open on their remembered or default
        journal view.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:02:18.467Z
        commit: 9a9c14c9e3e85cf5878e450fa2be786cd068fea8
  endsWith: Portable records are available and the saved journal can be read with
    the photographs.
  variations: []
  rules: []
  involves: []
mechanics:
  touchpoints:
    - src/components/tabs/ExportTab.svelte
    - src/components/tabs/PlanTab.svelte
    - src/components/JournalView.svelte
    - src/lib/export.ts
    - src/lib/csv.ts
    - src/lib/journal.ts
    - src/lib/markdown.ts
    - src/lib/download.ts
    - src/lib/copy.svelte.ts
    - src/lib/db.ts
  routes:
    - "#/trip/:id/export"
    - "#/trip/:id/plan"
  components:
    - src/components/tabs/ExportTab.svelte
    - src/components/tabs/PlanTab.svelte
    - src/components/JournalView.svelte
  entities:
    - Trip
    - City
    - Stop
    - Moment
    - Expense
    - Photo
  tests:
    - file: tests/e2e/moments.spec.ts
      steps: []
    - file: tests/e2e/expenses.spec.ts
      steps: []
    - file: tests/e2e/maps.spec.ts
      steps: []
approval:
  hash: 14b4f98b639a8cf30629862c2e905a02d44985c7784d539415deccb30f15774b
  at: 2026-11-09T14:29:10.921Z
  by: owner
  signature: ZuNAh62E7NT7HqepzE/le6dF9gTA1Kt50gKS7sJQOjqZ2HQSi9t+qXgC7ZMX5jwwdjlDk9lGgnrt2iDqtSBOAw==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Export a trip and save its journal

_Works now · approved 2026-11-09T14:29:10.921Z by owner (signed)_

## Goal

Take records out of Systema and keep a finished journal with the trip.

## Starts when

The traveller opens the Export tab.

## Needs first

_nothing extra required_

## Steps

1. **Traveller** Download the trip pack, expense CSV or numbered photographs, or copy a journaling prompt.
   - Shows: Portable files or a copy or share fallback are offered.
   - Changes: Source records stay on the device.

2. **Traveller** Write a journal externally, paste it and save.
   - Shows: Success or failure is reported; clearing a saved journal asks for confirmation.
   - Changes: Journal text is stored on the trip.

3. **Traveller** Open Journal on the Plan tab.
   - Shows: Rendered journal, matched photographs, remaining gallery and available route pins appear.
   - Changes: Completed trips with a journal open on their remembered or default journal view.

## Ends with

Portable records are available and the saved journal can be read with the photographs.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_

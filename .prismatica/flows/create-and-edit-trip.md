---
id: create-and-edit-trip
createdAt: 2026-11-09T14:20:02.154Z
status: works
presentation:
  title: Create and edit a trip
  journey: Travel
  order: 1
truth:
  goal: Keep a trip, its city legs, dates and departure details on the device.
  startsWhen: The traveller chooses New trip on Home or edits an existing trip.
  needs: []
  steps:
    - actor: Traveller
      action: Choose a preset.
      shows: The new trip opens on Edit trip.
      changes: A trip and any preset expense placeholders are created.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:02:09.184Z
        commit: c485e59cd81b6bd1b6880b60ed752a53bd6b1e18
    - actor: Traveller
      action: Add or edit city legs, currency, times, accommodation and travel details.
      shows: Saved feedback, derived trip information and chronology problems are
        displayed.
      changes: Fields save locally; impossible arrival/departure ordering is refused.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:02:09.184Z
        commit: c485e59cd81b6bd1b6880b60ed752a53bd6b1e18
    - actor: Traveller
      action: Finish editing and return to the trip.
      shows: The trip opens with its plan and departure information.
      changes: The saved trip is available from Home without requiring a network.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:02:09.184Z
        commit: c485e59cd81b6bd1b6880b60ed752a53bd6b1e18
  endsWith: The trip has saved legs and travel details that feed planning and
    preparation.
  variations: []
  rules: []
  involves: []
mechanics:
  touchpoints:
    - src/routes/NewTrip.svelte
    - src/routes/TripEdit.svelte
    - src/routes/Trip.svelte
    - src/components/DepartureEditor.svelte
    - src/lib/trips.ts
    - src/lib/presets.ts
    - src/lib/trip-shape.ts
    - src/lib/tz.ts
    - src/lib/db.ts
  routes:
    - "#/new"
    - "#/trip/:id/edit"
    - "#/trip/:id/plan"
  components:
    - src/routes/NewTrip.svelte
    - src/routes/TripEdit.svelte
    - src/routes/Trip.svelte
    - src/components/DepartureEditor.svelte
  entities:
    - Trip
    - City
    - Expense
  tests:
    - file: tests/e2e/smoke.spec.ts
      steps: []
    - file: tests/e2e/booking-workflow.spec.ts
      steps: []
approval:
  hash: 22465f6abe86848ac54d7ba0ee5c2ad052370695c8c5c077195773dcec9a91c6
  at: 2026-11-09T14:29:10.913Z
  by: owner
  signature: j02AC4peNn8H0vzK+AbRm1eQepSTdiFlNAHu8t2ad2AzCR62TT7GRwOIFzZNRRgbzDyuYLEQP1ViitkzuXhpAw==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Create and edit a trip

_Works now · approved 2026-11-09T14:29:10.913Z by owner (signed)_

## Goal

Keep a trip, its city legs, dates and departure details on the device.

## Starts when

The traveller chooses New trip on Home or edits an existing trip.

## Needs first

_nothing extra required_

## Steps

1. **Traveller** Choose a preset.
   - Shows: The new trip opens on Edit trip.
   - Changes: A trip and any preset expense placeholders are created.

2. **Traveller** Add or edit city legs, currency, times, accommodation and travel details.
   - Shows: Saved feedback, derived trip information and chronology problems are displayed.
   - Changes: Fields save locally; impossible arrival/departure ordering is refused.

3. **Traveller** Finish editing and return to the trip.
   - Shows: The trip opens with its plan and departure information.
   - Changes: The saved trip is available from Home without requiring a network.

## Ends with

The trip has saved legs and travel details that feed planning and preparation.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_

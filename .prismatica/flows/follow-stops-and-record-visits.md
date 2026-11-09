---
id: follow-stops-and-record-visits
createdAt: 2026-11-09T14:20:02.154Z
status: works
presentation:
  title: Follow Stops and record visits
  journey: Travel
  order: 4
truth:
  goal: Use the planned route while keeping a separate record of actual visits.
  startsWhen: The traveller opens the Stops tab.
  needs: []
  steps:
    - actor: Traveller
      action: Open the list or map, choose a city and open a Stop.
      shows: Planned order, notes, visit guidance, checklists and available pins
        appear.
      changes: The chosen view is remembered locally.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
    - actor: Traveller
      action: Open directions for a Stop with a pin.
      shows: Google Maps opens for the destination.
      changes: Opening directions does not mark a visit.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
    - actor: Traveller
      action: Mark a visit, correct its time, or edit notes, checklist and photos.
      shows: Saved feedback and the Visited view show the recorded history.
      changes: Visit facts and edits persist independently of planned order.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
  endsWith: Actual visits are recorded while the planned order remains distinct.
  variations: []
  rules: []
  involves: []
mechanics:
  touchpoints:
    - src/components/tabs/StopsTab.svelte
    - src/components/StopsMap.svelte
    - src/components/PhotoGallery.svelte
    - src/components/PhotoPicker.svelte
    - src/lib/stops.ts
    - src/lib/maps.ts
    - src/lib/photos.ts
    - src/lib/moments.ts
    - src/lib/tz.ts
    - src/lib/db.ts
  routes:
    - "#/trip/:id/stops"
    - "#/trip/:id/stops/:stopId"
  components:
    - src/components/tabs/StopsTab.svelte
    - src/components/StopsMap.svelte
    - src/components/PhotoGallery.svelte
    - src/components/PhotoPicker.svelte
  entities:
    - Stop
    - City
    - Moment
    - Photo
  tests:
    - file: tests/e2e/stops-travel.spec.ts
      steps: []
    - file: tests/e2e/maps.spec.ts
      steps: []
approval:
  hash: b7cf61b4de41048c260a6c33a9ee589dcd2517091e4249d6bfc4907b0e90a36b
  at: 2026-11-09T14:29:10.928Z
  by: owner
  signature: WbODyZsVZn0FsE6LrB28i6MjC3bjgjOUXITsalhb1L/oUD1lbJlmLhtpxarihd6ngvuiprStZJB4nA9mUxlWCA==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Follow Stops and record visits

_Works now · approved 2026-11-09T14:29:10.928Z by owner (signed)_

## Goal

Use the planned route while keeping a separate record of actual visits.

## Starts when

The traveller opens the Stops tab.

## Needs first

_nothing extra required_

## Steps

1. **Traveller** Open the list or map, choose a city and open a Stop.
   - Shows: Planned order, notes, visit guidance, checklists and available pins appear.
   - Changes: The chosen view is remembered locally.

2. **Traveller** Open directions for a Stop with a pin.
   - Shows: Google Maps opens for the destination.
   - Changes: Opening directions does not mark a visit.

3. **Traveller** Mark a visit, correct its time, or edit notes, checklist and photos.
   - Shows: Saved feedback and the Visited view show the recorded history.
   - Changes: Visit facts and edits persist independently of planned order.

## Ends with

Actual visits are recorded while the planned order remains distinct.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_


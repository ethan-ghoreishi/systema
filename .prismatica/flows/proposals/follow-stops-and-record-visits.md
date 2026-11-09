---
id: follow-stops-and-record-visits
proposalType: update
reason: "Change 20261109-close-stop-plan-revision-and-photo-relia-a0e7: a leg
  picker beside Add a stop, placement with the chosen leg, partial photo batch
  feedback with retry, and a save-original fallback for photos the browser
  cannot show."
proposedBy: agent
createdAt: 2026-11-09T17:16:04.256Z
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
      shows: Saved feedback and the Visited view show the recorded history; a photo
        batch that stops part-way says how many saved and offers to retry only
        the rest; a photo this browser can't show offers its original to save.
      changes: Visit facts and edits persist independently of planned order; photos
        already saved stay, and a retry never adds them twice.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T17:20:00.000Z
        note: Code reading in the change lane; mapped tests are pointers, not manual
          verification.
  endsWith: Actual visits are recorded while the planned order remains distinct.
  variations:
    - name: Add a place by hand
      differs: The new place joins the leg the planned route ends in (places kept off
        the route don't count), the only leg, or a leg chosen beside the box —
        repeated cities are labelled by leg — and sits with that leg's places.
        With several legs and no route it stays unassigned until chosen.
      status: works
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
    - file: tests/e2e/travel-reliability.spec.ts
      steps:
        - 3
---

# Proposed update: Follow Stops and record visits

_Proposed by agent · Works now_

**Reason:** Change 20261109-close-stop-plan-revision-and-photo-relia-a0e7: a leg picker beside Add a stop, placement with the chosen leg, partial photo batch feedback with retry, and a save-original fallback for photos the browser cannot show.

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
   - Shows: Saved feedback and the Visited view show the recorded history; a photo batch that stops part-way says how many saved and offers to retry only the rest; a photo this browser can't show offers its original to save.
   - Changes: Visit facts and edits persist independently of planned order; photos already saved stay, and a retry never adds them twice.

## Ends with

Actual visits are recorded while the planned order remains distinct.

## Variations

- **Add a place by hand** — The new place joins the leg the planned route ends in (places kept off the route don't count), the only leg, or a leg chosen beside the box — repeated cities are labelled by leg — and sits with that leg's places. With several legs and no route it stays unassigned until chosen. _(Works now)_

## Rules

_none stated_

## Involves

_not specified_

**Kept as the current Flow has it (not mentioned by this proposal):** presentation, mechanics.touchpoints, mechanics.routes, mechanics.components, mechanics.entities

**Removes from the current Flow:** nothing

<!-- prismatica:completed-against status=2fc8ad4541cd957b presentation=aaa878effea79bb5 truth.goal=8fab949389fa5efb truth.startsWhen=9095521032438780 truth.needs=4f53cda18c2baa0c truth.steps=c1d80c637607acc6 truth.endsWith=daa4a366c49587d8 truth.variations=4f53cda18c2baa0c truth.rules=4f53cda18c2baa0c truth.involves=4f53cda18c2baa0c mechanics.touchpoints=77ccaa3609a18ce6 mechanics.routes=805cbfd7b2ec999c mechanics.components=c284e577482f0277 mechanics.entities=d574680c88662ee6 mechanics.tests=1c3a2404c39465f1 -->

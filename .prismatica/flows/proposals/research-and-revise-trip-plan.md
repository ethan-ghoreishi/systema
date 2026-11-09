---
id: research-and-revise-trip-plan
proposalType: update
reason: "Change 20261109-close-stop-plan-revision-and-photo-relia-a0e7: review
  asks about ambiguous matches instead of showing them as new places, repeated
  city names leave new places unassigned, and provably untouched generated
  checklist items are retired on revision."
proposedBy: agent
createdAt: 2026-11-09T17:07:35.552Z
status: works
presentation:
  title: Research and revise a plan
  journey: Travel
  order: 2
truth:
  goal: Bring external research into a trip and reconcile Stops while retaining
    personal history.
  startsWhen: The traveller opens the research prompt or pastes or edits a plan.
  needs: []
  steps:
    - actor: Traveller
      action: Choose research preferences and copy a trip or city prompt.
      shows: A prompt is copied or offered through the copy fallback.
      changes: Preferences are remembered; the app makes no AI request.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
    - actor: Traveller
      action: Run the prompt outside Systema and paste the answer, or edit the
        existing plan.
      shows: Review Stops shows extracted places, proposed matches and retained
        places; a place two or more existing records could be is marked and
        offers only those records (with leg and visit) or a new place.
      changes: The plan remains a draft until review is applied.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T17:10:00.000Z
        note: Code reading in the change lane; mapped tests are pointers, not manual
          verification.
    - actor: Traveller
      action: Decide each ambiguous place, review the other matches and apply the plan.
      shows: Apply stays unavailable until every ambiguous place is decided; the plan
        and Stops update together; a failed save retains the draft.
      changes: Personal edits, visits, photos, bookings and linked Moments are
        retained; visited places removed from the route stay off it; a new place
        under a city the trip visits more than once stays unassigned; unticked
        checklist items the plan wrote and no longer lists are retired, while
        ticked, hand-added and older items stay.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T17:10:00.000Z
        note: Code reading in the change lane; mapped tests are pointers, not manual
          verification.
  endsWith: The revised plan and Stops are saved together with personal records retained.
  variations: []
  rules:
    - r-preserve-personal-history
  involves: []
mechanics:
  touchpoints:
    - src/routes/PromptBuilder.svelte
    - src/components/tabs/PlanTab.svelte
    - src/components/PastePlanDialog.svelte
    - src/components/PlanRevision.svelte
    - src/lib/prompt.ts
    - src/lib/plan-revision.ts
    - src/lib/stops.ts
    - src/lib/headings.ts
    - src/lib/copy.svelte.ts
    - src/lib/db.ts
  routes:
    - "#/trip/:id/prompt"
    - "#/trip/:id/plan"
  components:
    - src/routes/PromptBuilder.svelte
    - src/components/tabs/PlanTab.svelte
    - src/components/PastePlanDialog.svelte
    - src/components/PlanRevision.svelte
  entities:
    - Trip
    - City
    - Stop
    - Moment
    - Photo
  tests:
    - file: tests/e2e/research.spec.ts
      steps: []
    - file: tests/e2e/plan-capture-revision.spec.ts
      steps: []
    - file: tests/e2e/travel-reliability.spec.ts
      steps:
        - 2
        - 3
    - file: tests/unit/compat.test.ts
      steps:
        - 3
---

# Proposed update: Research and revise a plan

_Proposed by agent · Works now_

**Reason:** Change 20261109-close-stop-plan-revision-and-photo-relia-a0e7: review asks about ambiguous matches instead of showing them as new places, repeated city names leave new places unassigned, and provably untouched generated checklist items are retired on revision.

## Goal

Bring external research into a trip and reconcile Stops while retaining personal history.

## Starts when

The traveller opens the research prompt or pastes or edits a plan.

## Needs first

_nothing extra required_

## Steps

1. **Traveller** Choose research preferences and copy a trip or city prompt.
   - Shows: A prompt is copied or offered through the copy fallback.
   - Changes: Preferences are remembered; the app makes no AI request.

2. **Traveller** Run the prompt outside Systema and paste the answer, or edit the existing plan.
   - Shows: Review Stops shows extracted places, proposed matches and retained places; a place two or more existing records could be is marked and offers only those records (with leg and visit) or a new place.
   - Changes: The plan remains a draft until review is applied.

3. **Traveller** Decide each ambiguous place, review the other matches and apply the plan.
   - Shows: Apply stays unavailable until every ambiguous place is decided; the plan and Stops update together; a failed save retains the draft.
   - Changes: Personal edits, visits, photos, bookings and linked Moments are retained; visited places removed from the route stay off it; a new place under a city the trip visits more than once stays unassigned; unticked checklist items the plan wrote and no longer lists are retired, while ticked, hand-added and older items stay.

## Ends with

The revised plan and Stops are saved together with personal records retained.

## Variations

_none_

## Rules

- r-preserve-personal-history

## Involves

_not specified_

**Kept as the current Flow has it (not mentioned by this proposal):** presentation, mechanics.touchpoints, mechanics.routes, mechanics.components, mechanics.entities

**Removes from the current Flow:** nothing

<!-- prismatica:completed-against status=2fc8ad4541cd957b presentation=45eaf1e67d575afb truth.goal=f09d35616a222156 truth.startsWhen=2db879488d97828d truth.needs=4f53cda18c2baa0c truth.steps=78c05bc4858cca8b truth.endsWith=8d07577ae4756412 truth.variations=4f53cda18c2baa0c truth.rules=4f53cda18c2baa0c truth.involves=4f53cda18c2baa0c mechanics.touchpoints=66964d5c0a67e60e mechanics.routes=949c5ed8ebff8721 mechanics.components=461ffd91fadf7c23 mechanics.entities=ec067e5549e6e8af mechanics.tests=c585e3b2a999e947 -->

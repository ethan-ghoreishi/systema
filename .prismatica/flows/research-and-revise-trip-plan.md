---
id: research-and-revise-trip-plan
createdAt: 2026-11-09T14:20:02.154Z
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
        method: manual
        at: 2026-11-09T20:03:19.715Z
        commit: bfd8da936cb379bab7a219ff0628cc8b3df7f788
    - actor: Traveller
      action: Run the prompt outside Systema and paste the answer, or edit the
        existing plan.
      shows: Review Stops shows extracted places, proposed matches and retained
        places; a place two or more existing records could be is marked and
        offers only those records (with leg and visit) or a new place.
      changes: The plan remains a draft until review is applied.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:03:19.715Z
        commit: bfd8da936cb379bab7a219ff0628cc8b3df7f788
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
        method: manual
        at: 2026-11-09T20:03:19.715Z
        commit: bfd8da936cb379bab7a219ff0628cc8b3df7f788
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
approval:
  hash: 0621827b47f3a23e54170596702cd665d94525599cd4474ab59214954d39c48e
  at: 2026-11-09T20:00:55.191Z
  by: owner
  signature: 1W3VOPli3sDAcvV3j+9zNip05EGVt0uvwu8HlSBxunpWZCWxkrQsniylL5FMRUy+ZHxc20nJs48gL17aq5+FDg==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Research and revise a plan

_Works now · approved 2026-11-09T20:00:55.191Z by owner (signed)_

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

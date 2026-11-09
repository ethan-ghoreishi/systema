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
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
    - actor: Traveller
      action: Run the prompt outside Systema and paste the answer, or edit the
        existing plan.
      shows: Review Stops shows extracted places, proposed matches and retained
        places.
      changes: The plan remains a draft until review is applied.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
    - actor: Traveller
      action: Review the matches and apply the plan.
      shows: The plan and Stops update together; a failed save retains the draft.
      changes: Personal edits, visits, photos, bookings and linked Moments are
        retained; visited places removed from the route stay off it.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
  endsWith: The revised plan and Stops are saved together with personal records retained.
  variations: []
  rules: []
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
approval:
  hash: c6dafbd9cad617b758ee5e8aee4f9a120ce5b138ad492486f6f88acfb3d2890b
  at: 2026-11-09T14:29:10.957Z
  by: owner
  signature: ApPtrYZt+58vGj71+ARtId0VFXQb+5kWOd9xdPaSwhpKn+BvQFWNLSHNz4/K0WWz+kcZ07mjf2HZMuBSMYs9Aw==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Research and revise a plan

_Works now · approved 2026-11-09T14:29:10.957Z by owner (signed)_

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
   - Shows: Review Stops shows extracted places, proposed matches and retained places.
   - Changes: The plan remains a draft until review is applied.

3. **Traveller** Review the matches and apply the plan.
   - Shows: The plan and Stops update together; a failed save retains the draft.
   - Changes: Personal edits, visits, photos, bookings and linked Moments are retained; visited places removed from the route stay off it.

## Ends with

The revised plan and Stops are saved together with personal records retained.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_


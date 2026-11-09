---
id: consider-destinations-and-choose-trip
createdAt: 2026-11-09T14:20:02.154Z
status: works
presentation:
  title: Compare options and choose a trip
  journey: Travel
  order: 0
truth:
  goal: Turn destination research and travel options into a trip while retaining
    alternatives.
  startsWhen: The traveller opens Considering on Home or adds a Finder search.
  needs: []
  steps:
    - actor: Traveller
      action: Add a destination manually, or select Finder CSV rows and optional
        search settings.
      shows: Destinations and selected options appear under Considering.
      changes: Local opportunities and options are created or refreshed.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
    - actor: Traveller
      action: Open a destination, edit research or options and compare estimates.
      shows: Costs, stale fares, assumptions and missing inputs are shown.
      changes: Research and option edits persist locally.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
    - actor: Traveller
      action: Choose an option.
      shows: A linked trip appears with known facts and a list of details still to
        add.
      changes: Trip and cities are created; quotes remain separate from payments, and
        research and alternatives remain.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
  endsWith: A linked trip is available for planning without losing the research
    behind the choice.
  variations: []
  rules: []
  involves: []
mechanics:
  touchpoints:
    - src/routes/Home.svelte
    - src/routes/Opportunity.svelte
    - src/components/FinderImport.svelte
    - src/components/OptionEditor.svelte
    - src/lib/options.ts
    - src/lib/opportunities.ts
    - src/lib/insights.ts
    - src/lib/db.ts
  routes:
    - "#/"
    - "#/opp/:id"
  components:
    - src/routes/Home.svelte
    - src/routes/Opportunity.svelte
    - src/components/FinderImport.svelte
    - src/components/OptionEditor.svelte
  entities:
    - Opportunity
    - TripOption
    - Trip
    - City
    - Expense
  tests:
    - file: tests/e2e/opportunities.spec.ts
      steps: []
approval:
  hash: ea7bd38a7d5effd3e4b6132e1feac8321d58261c11164bfd30eb0259082c4b22
  at: 2026-11-09T14:29:10.906Z
  by: owner
  signature: mAI8zE4SCgPEV2eONJzcXd/25eLQuAFU9LyM91c66Iy6Rs4CVV7OScUIPBnC8BS1WhpILBsvR3X9fL8SUEmMAQ==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Compare options and choose a trip

_Works now · approved 2026-11-09T14:29:10.906Z by owner (signed)_

## Goal

Turn destination research and travel options into a trip while retaining alternatives.

## Starts when

The traveller opens Considering on Home or adds a Finder search.

## Needs first

_nothing extra required_

## Steps

1. **Traveller** Add a destination manually, or select Finder CSV rows and optional search settings.
   - Shows: Destinations and selected options appear under Considering.
   - Changes: Local opportunities and options are created or refreshed.

2. **Traveller** Open a destination, edit research or options and compare estimates.
   - Shows: Costs, stale fares, assumptions and missing inputs are shown.
   - Changes: Research and option edits persist locally.

3. **Traveller** Choose an option.
   - Shows: A linked trip appears with known facts and a list of details still to add.
   - Changes: Trip and cities are created; quotes remain separate from payments, and research and alternatives remain.

## Ends with

A linked trip is available for planning without losing the research behind the choice.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_


---
id: compare-travel-costs
createdAt: 2026-11-09T14:20:02.154Z
status: works
presentation:
  title: Compare recorded travel costs
  journey: Travel
  order: 10
truth:
  goal: Compare saved city costs and travel patterns with the evidence limits
    visible.
  startsWhen: The traveller opens Insights from Home.
  needs: []
  steps:
    - actor: Systema
      action: Read saved trips, cities, expenses, Stops and Moments.
      shows: Overview and What this rests on disclose sample sizes and incomplete
        inputs.
      changes: No travel records change.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:01:39.331Z
        commit: 496419440b221cb0193de719fd56c27ba3a3c122
    - actor: Traveller
      action: Choose a comparison question and inspect city, transfer and trip-pattern
        rows.
      shows: The measure shows thin-data, unpriced and trip-wide spending caveats.
      changes: Only the remembered comparison choice changes.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:01:39.331Z
        commit: 496419440b221cb0193de719fd56c27ba3a3c122
    - actor: Traveller
      action: Export all expenses as CSV for reconciliation.
      shows: The master-sheet-compatible CSV is downloaded with any unpriced-entry
        note.
      changes: Source records remain unchanged.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:01:39.331Z
        commit: 496419440b221cb0193de719fd56c27ba3a3c122
  endsWith: An evidence-qualified comparison or portable ledger export is available.
  variations: []
  rules: []
  involves: []
mechanics:
  touchpoints:
    - src/routes/Insights.svelte
    - src/routes/Home.svelte
    - src/lib/insights.ts
    - src/lib/csv.ts
    - src/lib/download.ts
    - src/lib/db.ts
  routes:
    - "#/insights"
  components:
    - src/routes/Insights.svelte
    - src/routes/Home.svelte
  entities:
    - Trip
    - City
    - Expense
    - Stop
    - Moment
  tests:
    - file: tests/e2e/insights.spec.ts
      steps: []
approval:
  hash: b0f39258bbcd365efea929c19ed25e271a5a64efb2603affaf69c52acfeb0845
  at: 2026-11-09T14:29:10.898Z
  by: owner
  signature: jdPnVqNnfk608wZS7KZgKgYu4pRtscRWTnMZmfzX+fVLE8vEN5mN65Ollz1j/bFs7uRJ/qdGFtfy/FJnOTxOCg==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Compare recorded travel costs

_Works now · approved 2026-11-09T14:29:10.898Z by owner (signed)_

## Goal

Compare saved city costs and travel patterns with the evidence limits visible.

## Starts when

The traveller opens Insights from Home.

## Needs first

_nothing extra required_

## Steps

1. **Systema** Read saved trips, cities, expenses, Stops and Moments.
   - Shows: Overview and What this rests on disclose sample sizes and incomplete inputs.
   - Changes: No travel records change.

2. **Traveller** Choose a comparison question and inspect city, transfer and trip-pattern rows.
   - Shows: The measure shows thin-data, unpriced and trip-wide spending caveats.
   - Changes: Only the remembered comparison choice changes.

3. **Traveller** Export all expenses as CSV for reconciliation.
   - Shows: The master-sheet-compatible CSV is downloaded with any unpriced-entry note.
   - Changes: Source records remain unchanged.

## Ends with

An evidence-qualified comparison or portable ledger export is available.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_

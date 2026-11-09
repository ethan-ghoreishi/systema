---
id: prepare-bookings-and-departures
createdAt: 2026-11-09T14:20:02.154Z
status: works
presentation:
  title: Prepare bookings and departures
  journey: Travel
  order: 3
truth:
  goal: See what remains to arrange, keep reservation and payment facts, and
    prepare to leave.
  startsWhen: The traveller opens the Plan tab of an upcoming trip.
  needs:
    - A trip with enough details to derive the relevant needs.
  steps:
    - actor: Systema
      action: Derive needs, personal preparation and the next departure from the saved
        trip.
      shows: Before you go, Getting ready and departure information distinguish
        planned, booked and paid.
      changes: Booking needs are derived rather than stored as a second task list.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
    - actor: Traveller
      action: Open a need and enter the known reservation or actual payment.
      shows: A reference-only save reads booked; payment appears in Expenses with any
        pending currency rate stated.
      changes: Booking facts and linked payment changes save together; a reference
        alone creates no payment.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
    - actor: Traveller
      action: Mark check-in or preparation items, add personal items or put irrelevant
        ones aside.
      shows: The remaining preparation updates.
      changes: Preparation and check-in choices persist on the trip or departure.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
  endsWith: Remaining arrangements and departure details reflect the saved evidence.
  variations: []
  rules: []
  involves: []
mechanics:
  touchpoints:
    - src/components/tabs/PlanTab.svelte
    - src/components/BeforeYouGo.svelte
    - src/components/BookNeed.svelte
    - src/components/PersonalPrep.svelte
    - src/components/NextDeparture.svelte
    - src/lib/needs.ts
    - src/lib/prep.ts
    - src/lib/readiness.ts
    - src/lib/quotes.ts
    - src/lib/db.ts
  routes:
    - "#/trip/:id/plan"
  components:
    - src/components/tabs/PlanTab.svelte
    - src/components/BeforeYouGo.svelte
    - src/components/BookNeed.svelte
    - src/components/PersonalPrep.svelte
    - src/components/NextDeparture.svelte
  entities:
    - Trip
    - City
    - Stop
    - Expense
  tests:
    - file: tests/e2e/booking-workflow.spec.ts
      steps: []
    - file: tests/e2e/roundtrip.spec.ts
      steps: []
approval:
  hash: 7df4f9267da375ecdc9d2237e500ea99539a935d8d71516588144dd60426f21d
  at: 2026-11-09T14:29:10.943Z
  by: owner
  signature: QdVcAZCKy3v30PkNFZ27g4+2vCPgoC+3V4/JHa9eBfOKJrDfjtkYy7v2gRz4QTCKGwvVYY33ElJiYCqq7zI6BA==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Prepare bookings and departures

_Works now · approved 2026-11-09T14:29:10.943Z by owner (signed)_

## Goal

See what remains to arrange, keep reservation and payment facts, and prepare to leave.

## Starts when

The traveller opens the Plan tab of an upcoming trip.

## Needs first

- A trip with enough details to derive the relevant needs.

## Steps

1. **Systema** Derive needs, personal preparation and the next departure from the saved trip.
   - Shows: Before you go, Getting ready and departure information distinguish planned, booked and paid.
   - Changes: Booking needs are derived rather than stored as a second task list.

2. **Traveller** Open a need and enter the known reservation or actual payment.
   - Shows: A reference-only save reads booked; payment appears in Expenses with any pending currency rate stated.
   - Changes: Booking facts and linked payment changes save together; a reference alone creates no payment.

3. **Traveller** Mark check-in or preparation items, add personal items or put irrelevant ones aside.
   - Shows: The remaining preparation updates.
   - Changes: Preparation and check-in choices persist on the trip or departure.

## Ends with

Remaining arrangements and departure details reflect the saved evidence.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_


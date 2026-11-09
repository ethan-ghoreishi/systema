---
id: record-and-review-expenses
createdAt: 2026-11-09T14:20:02.154Z
status: works
presentation:
  title: Record and review expenses
  journey: Travel
  order: 6
truth:
  goal: Keep actual spending, receipts and a truthful trip total.
  startsWhen: The traveller opens Expenses and adds or edits a purchase.
  needs: []
  steps:
    - actor: Traveller
      action: Enter an amount, choose a purchase template or category and confirm city
        or whole-trip scope.
      shows: The sheet supplies relevant defaults and editable details.
      changes: The purchase remains a draft.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:03:09.489Z
        commit: 6fff2334ab18ae0a6a95fe8fbaa4280e766ba283
    - actor: Traveller
      action: Save the purchase and optional receipts, reviewing any duplicate warning.
      shows: The expense appears or the draft remains with an error; missing rates are
        labelled pending.
      changes: Expense and receipts save together; a manual GBP amount is retained.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:03:09.489Z
        commit: 6fff2334ab18ae0a6a95fe8fbaa4280e766ba283
    - actor: Systema
      action: Show real spending totals and resolve pending conversion when rates
        become available.
      shows: Unpriced entries are counted separately from priced totals.
      changes: Rate resolution changes only the still-matching pending expense;
        estimates remain separate from spending.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:03:09.489Z
        commit: 6fff2334ab18ae0a6a95fe8fbaa4280e766ba283
  endsWith: The purchase and receipts are saved, and the ledger states any missing price.
  variations: []
  rules: []
  involves: []
mechanics:
  touchpoints:
    - src/components/ExpenseCapture.svelte
    - src/components/tabs/ExpensesTab.svelte
    - src/components/Keypad.svelte
    - src/lib/expenses.ts
    - src/lib/expense-defaults.ts
    - src/lib/money.ts
    - src/lib/fx.ts
    - src/lib/photos.ts
    - src/lib/db.ts
  routes:
    - "#/trip/:id/expenses"
  components:
    - src/components/ExpenseCapture.svelte
    - src/components/tabs/ExpensesTab.svelte
    - src/components/Keypad.svelte
  entities:
    - Expense
    - Photo
    - Trip
    - City
  tests:
    - file: tests/e2e/expenses.spec.ts
      steps: []
    - file: tests/e2e/production-readiness.spec.ts
      steps: []
approval:
  hash: 9f03906891d4bc27bd828b87af8f6066fa3dab33952d0e3e67d838e5771c7fa6
  at: 2026-11-09T14:29:10.950Z
  by: owner
  signature: pblfl+V02PVa9TcdtPe/RTNPHNvWWJ2V5N6anDQ0ZuXbSMij8R1zJoBNtx95vmER6Q5OCV/aXdNzJnvFT0q4Ag==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Record and review expenses

_Works now · approved 2026-11-09T14:29:10.950Z by owner (signed)_

## Goal

Keep actual spending, receipts and a truthful trip total.

## Starts when

The traveller opens Expenses and adds or edits a purchase.

## Needs first

_nothing extra required_

## Steps

1. **Traveller** Enter an amount, choose a purchase template or category and confirm city or whole-trip scope.
   - Shows: The sheet supplies relevant defaults and editable details.
   - Changes: The purchase remains a draft.

2. **Traveller** Save the purchase and optional receipts, reviewing any duplicate warning.
   - Shows: The expense appears or the draft remains with an error; missing rates are labelled pending.
   - Changes: Expense and receipts save together; a manual GBP amount is retained.

3. **Systema** Show real spending totals and resolve pending conversion when rates become available.
   - Shows: Unpriced entries are counted separately from priced totals.
   - Changes: Rate resolution changes only the still-matching pending expense; estimates remain separate from spending.

## Ends with

The purchase and receipts are saved, and the ledger states any missing price.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_

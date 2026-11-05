# Focused reliability correction, 5 November 2026

Started from current main, `ddba581`. One implementation/finalisation agent;
synthetic data only. No production travel records or NAS services were changed.

## Findings and decisions

- **Confirmed: decimal commas changed monetary magnitude.** BookNeed and
  OptionEditor removed every comma before converting a number: `12,50` became
  `1250`. Their shared parser now reads dot/comma decimals and properly grouped
  formats, rejects malformed/ambiguous input, and never treats invalid text as
  a blank payment. `1,234` and `1.234` need clarification; use `1234` for a whole
  thousand or an explicit decimal format such as `1,234.00`. Blank or zero
  amounts still permit a reservation with no recorded payment. The same parser
  covers Expenses' GBP override and imported Finder monetary fields. The keypad
  still supports partially typed decimals; currencies, FX and payment-intent
  rules are unchanged. No historical monetary records are reinterpreted.
- **Confirmed: a retrospective Moment defaulted to today.** Past/completed trips
  now begin with Event time unknown. The traveller can explicitly choose exact
  date/time, date only, approximate date, or unknown. Active capture retains Now.
  Unknown dates are not inferred from a Stop, trip dates, photo or creation time.
  Known times already stored are preserved, including potentially late entries;
  they can now be corrected or cleared by the traveller. Shared display/sort
  rules reach Stops, Visited, trip packs and both journal prompts. Estimates are
  labelled, and untimed memories imply no chronology.
- **Compatibility decision:** optional `timePrecision` metadata, without a schema
  upgrade or backup-version change. `at` stays finite for old readers; for an
  unknown Moment it is bookkeeping, never presented as an event date by this
  build. Date-only/approximate dates use a local-noon storage anchor which is
  never presented as a known clock time. Older builds cannot understand these
  semantics and still display `at`. Update both devices before using these
  controls. Validation, merge and ZIP round trips preserve the metadata.
- **Confirmed: deleted Stop writes could resolve successfully.** Dexie returns
  zero affected rows without throwing. Notes/name, leg, coordinate and visit-time
  writes now reject a missing Stop. Field comparisons remain inside the write.
  A synced deletion keeps the open text and coordinate drafts visible, read-only
  and available for copying, with autosave paused. It does not recreate a record.
  Map placement failures are visible and redraw the saved state. Existing stale
  note/pin protection and ordinary rapid autosave remain covered.
- **Partly substantiated: viewport recovery.** The keyboard measurement listened
  only to visualViewport events, so a restored/resumed page could keep stale
  state. It now refreshes on pageshow, visibility and window-size changes, without
  treating pinch zoom as a keyboard. The fixed shell uses the same dynamic
  viewport height as sheets rather than relying on the fixed containing block's
  size. No extra bottom spacing or keyboard-sized shell was added. Regression
  tests verify lifecycle refresh, whole-tab visibility at several sizes and
  existing field-reveal behaviour. These tests cannot prove the cause of the
  owner's intermittent physical-iPhone clipping or confirm its elimination.
- **Visual-review correction:** expanding the Moment's date controls could make
  its note textarea shrink until the text was clipped. Direct modal textareas
  now retain their intrinsic height and scroll with the form. Screenshot review
  and a minimum-height assertion cover this directly affected layout.

## Final scrutiny

Reviewed the complete diff and connected callers after implementation. No new
packages, storage migration, conflict-resolution subsystem, monetary history
rewrite, NAS receiver edits or unrelated refactoring. Missing-row checks do not
upsert; failed edits preserve the existing field comparison and transaction
rollback. New metadata is validated at backup/sync boundaries. Links continue
using existing Google Maps encoding and opener protection.

Same-date Moments have no asserted order beyond stable display ties. The final
browser run used a fresh server with no live source edits. Focusout retains the
existing page-settling behaviour; lifecycle events refresh keyboard measurements.

## Verification

Final local results: **385 unit tests, 483 browser tests and one production PWA
update test passed**. Three opt-in personal live-NAS tests were skipped. The
checks include the entire Vitest and three-profile Playwright suites, current,
previous and original PHP NAS receivers in an isolated temporary folder, the
production service-worker update test, type checking, lint, formatting, PHP
syntax, production build and whitespace checks. Live personal-NAS tests are
opt-in and remain skipped; no personal NAS was contacted.

Physical iPhone Safari and standalone PWA keyboard, camera, safe-area, Maps
handoff/resume and real-network/NAS behaviour remain owner acceptance checks.
There was no screen-reader session. Existing history cannot reveal whether an
old timestamp was recorded during the event or entered months later.

Use the single [iPhone and Mac walkthrough](iphone-mac-acceptance.md) for this
release and the recent booking, Stops, Visited, Moments and export improvements.

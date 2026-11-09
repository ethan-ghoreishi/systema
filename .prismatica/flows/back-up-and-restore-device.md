---
id: back-up-and-restore-device
createdAt: 2026-11-09T14:20:02.154Z
status: works
presentation:
  title: Back up and restore a device
  journey: Travel
  order: 8
truth:
  goal: Download a full backup and restore missing records without replacing
    existing work.
  startsWhen: The traveller opens Settings to download or restore a backup.
  needs: []
  steps:
    - actor: Traveller
      action: Download a full backup ZIP and save it off the device.
      shows: A download contains records and photo files, with progress or a failure
        message.
      changes: Only the local file-backup marker changes.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
    - actor: Traveller
      action: Select a ZIP or legacy JSON backup.
      shows: Validation and a preview show what would be added; damaged input is
        refused before writes.
      changes: The preview adds no records.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
    - actor: Traveller
      action: Confirm Restore these records, optionally enabling fill-empty-fields
        separately.
      shows: Added records, preserved differences and missing photos are reported.
      changes: Missing IDs are added; matching records remain, with blank fields
        filled only when explicitly requested.
      assumes: []
      evidence:
        method: inferred
        at: 2026-11-09T14:16:18.512Z
        commit: b35a63f7b1d71d1f18b3f3b5151644d86394d49f
        note: Code reading; mapped tests are pointers, not manual verification.
  endsWith: A separate backup is available and a validated restore preserves
    existing records.
  variations: []
  rules: []
  involves: []
mechanics:
  touchpoints:
    - src/routes/Settings.svelte
    - src/lib/export.ts
    - src/lib/backup-validation.ts
    - src/lib/zip.ts
    - src/lib/photos.ts
    - src/lib/db.ts
  routes:
    - "#/settings"
  components:
    - src/routes/Settings.svelte
  entities:
    - Trip
    - City
    - Stop
    - Moment
    - Expense
    - Photo
    - Opportunity
  tests:
    - file: tests/e2e/backup.spec.ts
      steps: []
    - file: tests/e2e/roundtrip.spec.ts
      steps: []
approval:
  hash: c36416e6a2c6579a83f3b2552ba57dc982e6273a11556660a90045c265b737fb
  at: 2026-11-09T14:29:10.873Z
  by: owner
  signature: cybQy9Ol1kJtxVz3xtARy5Z+Xl+iKPoXPxJ4n61vO+JeY99v83oGa7w4y9YcjtWkMPirSNxD8w/NFeKnox1XBg==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Back up and restore a device

_Works now · approved 2026-11-09T14:29:10.873Z by owner (signed)_

## Goal

Download a full backup and restore missing records without replacing existing work.

## Starts when

The traveller opens Settings to download or restore a backup.

## Needs first

_nothing extra required_

## Steps

1. **Traveller** Download a full backup ZIP and save it off the device.
   - Shows: A download contains records and photo files, with progress or a failure message.
   - Changes: Only the local file-backup marker changes.

2. **Traveller** Select a ZIP or legacy JSON backup.
   - Shows: Validation and a preview show what would be added; damaged input is refused before writes.
   - Changes: The preview adds no records.

3. **Traveller** Confirm Restore these records, optionally enabling fill-empty-fields separately.
   - Shows: Added records, preserved differences and missing photos are reported.
   - Changes: Missing IDs are added; matching records remain, with blank fields filled only when explicitly requested.

## Ends with

A separate backup is available and a validated restore preserves existing records.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_


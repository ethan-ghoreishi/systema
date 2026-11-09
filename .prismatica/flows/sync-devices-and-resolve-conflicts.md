---
id: sync-devices-and-resolve-conflicts
createdAt: 2026-11-09T14:20:02.154Z
status: works
presentation:
  title: Sync devices and review conflicts
  journey: Travel
  order: 9
truth:
  goal: Share changes through the configured NAS and retain conflicting edits for
    review.
  startsWhen: A configured device starts automatic or manual sync.
  needs:
    - A reachable compatible NAS receiver, with URL and token configured
      separately on each device.
  steps:
    - actor: Systema
      action: Validate the remote snapshot, upload eligible photos and merge against
        shared history.
      shows: Settings reports progress, connection failures or partial photo success.
      changes: Record changes merge transactionally; a fresh device merges before
        pushing.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:03:30.324Z
        commit: 13e7ab7d0af2a08d537b131f3fa7d730540fa33e
    - actor: Systema
      action: Push a changed merged snapshot, retrying when the receiver reports a
        newer snapshot.
      shows: Sync distinguishes success, partial photo uploads and failure.
      changes: Sync history advances after accepted writes; idle sync creates no
        snapshot.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:03:30.324Z
        commit: 13e7ab7d0af2a08d537b131f3fa7d730540fa33e
    - actor: Traveller
      action: Review edits made on two devices and choose the version to keep.
      shows: Settings presents both versions of a recorded conflict.
      changes: The selected resolution participates in subsequent sync.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:03:30.324Z
        commit: 13e7ab7d0af2a08d537b131f3fa7d730540fa33e
    - actor: Traveller
      action: Check the NAS copy or retry failed photos.
      shows: Health checks identify missing or failed files.
      changes: Available missing photos can be queued again; snapshot absence alone
        never removes photos.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:03:30.324Z
        commit: 13e7ab7d0af2a08d537b131f3fa7d730540fa33e
  endsWith: Devices converge through the NAS and conflicting edits remain reviewable.
  variations: []
  rules: []
  involves: []
mechanics:
  touchpoints:
    - src/routes/Settings.svelte
    - src/components/ConflictList.svelte
    - src/lib/nas.svelte.ts
    - src/lib/sync.ts
    - src/lib/conflicts.ts
    - src/lib/backup-validation.ts
    - src/lib/settings.ts
    - src/lib/export.ts
    - src/lib/db.ts
    - nas/systema-backup.php
  routes:
    - "#/settings"
  components:
    - src/routes/Settings.svelte
    - src/components/ConflictList.svelte
  entities:
    - Trip
    - City
    - Stop
    - Moment
    - Expense
    - Photo
    - Opportunity
    - ConflictRecord
  tests:
    - file: tests/e2e/sync.spec.ts
      steps: []
    - file: tests/e2e/roundtrip.spec.ts
      steps: []
approval:
  hash: 7d6e3485b4e1a0c7b717407ec232f26beb663ce1dee9a0b6faed36d6810c219e
  at: 2026-11-09T14:29:10.964Z
  by: owner
  signature: nTGtg4z+W3tvISROoNbYPUCuLyfBjMl9NWE1xPK/VlTRLlhowCMUUkLUOogzSW12PW9SPU6RNo5dzzCxHa14Dw==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Sync devices and review conflicts

_Works now · approved 2026-11-09T14:29:10.964Z by owner (signed)_

## Goal

Share changes through the configured NAS and retain conflicting edits for review.

## Starts when

A configured device starts automatic or manual sync.

## Needs first

- A reachable compatible NAS receiver, with URL and token configured separately on each device.

## Steps

1. **Systema** Validate the remote snapshot, upload eligible photos and merge against shared history.
   - Shows: Settings reports progress, connection failures or partial photo success.
   - Changes: Record changes merge transactionally; a fresh device merges before pushing.

2. **Systema** Push a changed merged snapshot, retrying when the receiver reports a newer snapshot.
   - Shows: Sync distinguishes success, partial photo uploads and failure.
   - Changes: Sync history advances after accepted writes; idle sync creates no snapshot.

3. **Traveller** Review edits made on two devices and choose the version to keep.
   - Shows: Settings presents both versions of a recorded conflict.
   - Changes: The selected resolution participates in subsequent sync.

4. **Traveller** Check the NAS copy or retry failed photos.
   - Shows: Health checks identify missing or failed files.
   - Changes: Available missing photos can be queued again; snapshot absence alone never removes photos.

## Ends with

Devices converge through the NAS and conflicting edits remain reviewable.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_

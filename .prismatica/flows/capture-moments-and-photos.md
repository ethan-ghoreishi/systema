---
id: capture-moments-and-photos
createdAt: 2026-11-09T14:20:02.154Z
status: works
presentation:
  title: Capture a Moment
  journey: Travel
  order: 5
truth:
  goal: Keep an encounter or event with optional time, place, Stop link and
    photographs.
  startsWhen: The traveller chooses What happened? or opens a Moment.
  needs: []
  steps:
    - actor: Traveller
      action: Enter a title and optional note, city, Stop, location and time precision.
      shows: The sheet explains the time or its uncertainty; retrospective capture
        permits unknown time.
      changes: Fields remain a draft until Save.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:01:26.964Z
        commit: 69d5311e036ba61b9a1b873f3e74790fb5a60bcd
    - actor: Traveller
      action: Optionally add camera or library photographs and save.
      shows: The Moment appears; failed saves leave the entry in the sheet.
      changes: Moment and prepared photo records are written transactionally.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:01:26.964Z
        commit: 69d5311e036ba61b9a1b873f3e74790fb5a60bcd
    - actor: Traveller
      action: Reopen the Moment to correct details or inspect photographs.
      shows: The entry, optional link and photographs appear.
      changes: Corrections preserve explicit time precision; date-only entries retain
        their calendar date when the city changes.
      assumes: []
      evidence:
        method: manual
        at: 2026-11-09T20:01:26.964Z
        commit: 69d5311e036ba61b9a1b873f3e74790fb5a60bcd
  endsWith: A saved Moment preserves the event and its optional photographs and links.
  variations: []
  rules: []
  involves: []
mechanics:
  touchpoints:
    - src/components/MomentCapture.svelte
    - src/components/tabs/StopsTab.svelte
    - src/components/PhotoGallery.svelte
    - src/lib/moments.ts
    - src/lib/photos.ts
    - src/lib/exif.ts
    - src/lib/tz.ts
    - src/lib/db.ts
  routes:
    - "#/trip/:id/stops"
  components:
    - src/components/MomentCapture.svelte
    - src/components/tabs/StopsTab.svelte
    - src/components/PhotoGallery.svelte
  entities:
    - Moment
    - Photo
    - Stop
    - City
    - Trip
  tests:
    - file: tests/e2e/moments.spec.ts
      steps: []
    - file: tests/e2e/roundtrip.spec.ts
      steps: []
approval:
  hash: 69635f07804e9fc091dd76798658ce37bd460941e2227fa4fcb74faa10170a4f
  at: 2026-11-09T14:29:10.888Z
  by: owner
  signature: 1rY5wevSwcy4YiSusEFMF4l+GNunC0MNDuJEmTnj0UeEpAXvC/tulY8ym1Zp44qVW7toE0jwtNEmBnPbtPV0Cw==
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MCowBQYDK2VwAyEAxxaiErDKWXw9qQrVISVCyYQrsfvEEbOKmcLKt92Rkro=
    -----END PUBLIC KEY-----
---

# Capture a Moment

_Works now · approved 2026-11-09T14:29:10.888Z by owner (signed)_

## Goal

Keep an encounter or event with optional time, place, Stop link and photographs.

## Starts when

The traveller chooses What happened? or opens a Moment.

## Needs first

_nothing extra required_

## Steps

1. **Traveller** Enter a title and optional note, city, Stop, location and time precision.
   - Shows: The sheet explains the time or its uncertainty; retrospective capture permits unknown time.
   - Changes: Fields remain a draft until Save.

2. **Traveller** Optionally add camera or library photographs and save.
   - Shows: The Moment appears; failed saves leave the entry in the sheet.
   - Changes: Moment and prepared photo records are written transactionally.

3. **Traveller** Reopen the Moment to correct details or inspect photographs.
   - Shows: The entry, optional link and photographs appear.
   - Changes: Corrections preserve explicit time precision; date-only entries retain their calendar date when the city changes.

## Ends with

A saved Moment preserves the event and its optional photographs and links.

## Variations

_none_

## Rules

_none stated_

## Involves

_not specified_

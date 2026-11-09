---
id: 20261109-close-stop-plan-revision-and-photo-relia-a0e7
title: Close Stop, plan revision and photo reliability gaps
issue: https://github.com/ethan-ghoreishi/systema/issues/26
intent: 20261109-close-stop-plan-revision-and-photo-relia-a0e7
tier: heavy
stage: review
baseline:
  commit: 8f57daae54927b0dfb610dbd4574b9dc5e8977b4
  branch: main
branch: change/20261109-close-stop-plan-revision-and-photo-relia-a0e7
worktree: /Users/Ehsan/workspace/active/systema-lanes/20261109-close-stop-plan-revision-and-photo-relia-a0e7
builder: claude
planHash: 9624df027aea8bd542cc45e25618e66684102aeb1fadf747946231c42fdb0e53
allowedPaths:
  - src/lib/stops.ts
  - src/lib/plan-revision.ts
  - src/lib/photos.ts
  - src/lib/photo-format.ts
  - src/lib/photo-batch.ts
  - src/lib/export.ts
  - src/lib/nas.svelte.ts
  - src/lib/backup-validation.ts
  - src/lib/db.ts
  - src/lib/sync.ts
  - src/components/tabs/StopsTab.svelte
  - src/components/PlanRevision.svelte
  - src/components/MomentCapture.svelte
  - src/components/ExpenseCapture.svelte
  - src/components/PhotoPicker.svelte
  - src/components/PhotoGallery.svelte
  - src/components/CoverPicker.svelte
  - src/components/TripCover.svelte
  - src/components/JournalView.svelte
  - src/components/tabs/ExportTab.svelte
  - nas/systema-backup.php
  - README.md
  - docs/nas-backup-setup.md
  - docs/travel-reliability-closure.md
  - tests/unit/stops.test.ts
  - tests/unit/plan-revision.test.ts
  - tests/unit/photos.test.ts
  - tests/unit/export.test.ts
  - tests/unit/backup-validation.test.ts
  - tests/unit/compat.test.ts
  - tests/unit/sync.test.ts
  - tests/unit/travel-reliability.test.ts
  - tests/e2e/plan-capture-revision.spec.ts
  - tests/e2e/stops-travel.spec.ts
  - tests/e2e/research.spec.ts
  - tests/e2e/moments.spec.ts
  - tests/e2e/data-safety.spec.ts
  - tests/e2e/backup.spec.ts
  - tests/e2e/sync.spec.ts
  - tests/e2e/roundtrip.spec.ts
  - tests/e2e/php-receiver.spec.ts
  - tests/e2e/nas-fake.ts
  - tests/e2e/travel-reliability.spec.ts
  - tests/fixtures/reliability/sample.heic
  - tests/fixtures/reliability/sample.heif
  - tests/fixtures/reliability/sample.jpg
  - tests/fixtures/reliability/sample.png
  - tests/fixtures/reliability/sample.webp
forbiddenPaths:
  - .github/**
  - AGENTS.md
  - CLAUDE.md
  - package.json
  - package-lock.json
  - tests/unit/fixtures/old-backup-validation.ts
  - tests/unit/fixtures/old-sync.ts
  - tests/e2e/systema-backup-v1.php
  - tests/e2e/systema-backup-v1.1.php
nonGoals:
  - Preserve existing trip/Stop/City/Moment/expense IDs, visits and times,
    notes, pins, bookings, payment/FX links, original photo bytes/hashes and
    associations. Only the explicitly authorised safe retirement of obsolete
    generated checklist items may remove existing checklist content.
  - Keep plans staged until atomic apply, reject stale reviews, retain omitted
    places/history and personal route additions, and preserve return-to-route
    placement and unchanged-plan idempotence from PRs 23–25.
  - Keep IndexedDB/Dexie, offline capture and reading, optional NAS, add-only
    validated restore, explicit photo tombstones, merge/conflict semantics and
    historical backup compatibility. No destructive repair, storage clear,
    schema/version migration or mass rewrite.
  - No accounts, runtime AI, paid services, new external data destinations,
    codec dependency or background conversion pipeline. Any optional metadata
    must validate and survive old/new readers and sync without forcing an
    upgrade.
  - Use synthetic data and isolated browser contexts/temporary PHP receivers
    only. Native owner checks use a disposable origin/profile and test receiver,
    never the installed app database or live personal NAS. No canonical record
    hand edits, fabricated evidence, hook bypass, owner approvals or
    merge/release decisions by an agent.
  - No retrospective deduplication, guessed leg reassignment, old-checklist mass
    pruning, automatic file transcoding or photo deletion. Unknown legacy
    checklist provenance always prevents automatic retirement.
  - No itinerary/parser overhaul, fuzzy identity engine, new city-leg planning
    model, offline architecture change, thumbnail/cache subsystem, resumable
    background job framework, broad performance programme or unrelated UI
    redesign.
  - Scope permission is a ceiling, not a requirement to edit every listed file.
    db.ts is available for minimal optional types only; sync.ts and
    receipt/cover/journal consumers only for direct family compatibility or
    failure handling. No payment, authentication, token or deployment behaviour
    changes. New helper and fixture paths are reserved options, not an
    instruction to create an abstraction or add every fixture.
  - Native HEIC decoding everywhere, HEIF EXIF feature expansion and unlimited
    photo batch support are deferred. A memory redesign is deferred unless the
    fixed probe substantiates a failure; preserve and document a working bounded
    path instead.
acceptanceChecks:
  - id: ac-1
    description: Manual addition after revised routes with off-route tails uses the
      chosen or evidenced current leg and a stable route position. Cover
      empty/all-retained routes, zero/one/multiple legs, Vienna–Salzburg–Vienna,
      gapped/tied orders and rapid additions. Existing IDs/history and an
      unrelated trip remain unchanged.
    test: manual:Playwright journeys gate "manual Stops stay in the intended leg
      when retained records trail the itinerary" in
      tests/e2e/travel-reliability.spec.ts
  - id: ac-2
    description: Distinguish no match from multiple plausible exact matches,
      including repeated city names and imported-name aliases. Known ambiguity
      needs an explicit reuse/new choice; deliberate same-name new places remain
      possible. Selected records retain their leg and history, each ID is used
      at most once, and cancellation writes nothing.
    test: review separates ambiguous plan matches from no match and uses each record
      once
  - id: ac-3
    description: Legacy extraction, candidate-presence checks, guide backfill and
      reviewed apply agree on safe repeated-city identity. Exercise
      Vienna–Salzburg–Vienna, identical names on different legs, an unassigned
      existing Stop, deleted/unknown legs, missing city headings, and repeated
      application. No arbitrary last-leg assignment, cross-leg backfill or
      multiplying duplicates; unknown placement stays explicit.
    test: repeated-city plan logic never picks a leg a heading cannot name
  - id: ac-4
    description: Three revisions retire only established unchanged obsolete
      unchecked generated items. Completed, manual, edited, manually recreated
      and uncertain legacy items survive with stable IDs/ticks; retained source
      items are not duplicated. Include user deletion, missing planSource,
      same-text personal items and reapplication. Any new provenance survives
      validation, ZIP and old/new sync readers.
    test: repeated plan revisions retire only proven untouched generated checklist
      items
  - id: ac-5
    description: Preserve the already-fixed unchanged-plan repeated-city behaviour,
      including personal and returned-to-route Stops. Extend coverage only where
      necessary; do not weaken existing route-retention assertions.
    test: re-applying the same plan to a trip that returns to a city changes nothing
  - id: ac-6
    description: "Keep atomic apply and stale-editor protection: changed plan, Stop
      or City during review is refused without overwriting the other writer; an
      unstructured paste preserves the route and cancellation retains the
      draft."
    test: manual:Playwright journeys gate "a stale plan review refuses concurrent
      edits and an unstructured paste keeps the route" in
      tests/e2e/plan-capture-revision.spec.ts
  - id: ac-7
    description: Use genuine format fixtures with documented provenance and
      independently known byte hashes, not text blobs merely labelled as images.
      HEIC/HEIF, JPEG, PNG and WebP originals retain bytes, metadata links and
      correct format through single downloads, manifest/share output and ZIP
      restore. Include legacy .jpg-labelled HEIC/HEIF, absent/wrong MIME,
      corrupt/unrecognised input, current/old backups, add-only restore and an
      unrelated trip.
    test: ZIP restore reads HEIC and HEIF originals back byte for byte under any
      entry name
  - id: ac-8
    description: In a browser without the required decoder, affected photo views
      give honest unavailable-preview feedback and a working original download;
      decode failure never deletes, transforms or prevents retaining an
      original. A known decodable image still opens normally. Check Stop and
      Moment galleries and directly affected cover/journal readers.
    test: manual:Playwright journeys gate "undecodable photo previews keep the
      original available to save" in tests/e2e/travel-reliability.spec.ts
  - id: ac-9
    description: Two isolated devices converge on revised routes, repeated legs,
      checklist provenance/results and mixed-format photo bytes through current,
      previous and original real PHP receivers. Include missing photo
      download/restore, existing historical jpg originals, interrupted/lost
      upload response, repeat idle sync and explicit tombstones. Assert hashes,
      links and IDs, no missing-file false success or duplicate original, no
      extra snapshots on idle. Frozen old receivers/readers remain unchanged.
    test: manual:Playwright with real PHP receivers (CI) "revised routes and mixed
      photo formats converge through current and legacy NAS receivers" in
      tests/e2e/php-receiver.spec.ts
  - id: ac-10
    description: Exercise Stop batches and new/existing Moment and receipt saves,
      with fixed mixed sizes/capture times, missing EXIF, a failure before first
      save and an injected mid-batch read/hash/write/quota error. Existing
      originals stay intact; report partial Stop success and retain/retry
      pending work without duplicates. New Moment/expense plus photos roll back
      together and preserve the draft. Document measured batch/concurrency
      results and any conservative limit.
    test: manual:Playwright journeys gate "photo batch failures preserve committed
      records and retry without duplicating completed work" in
      tests/e2e/travel-reliability.spec.ts
  - id: ac-11
    description: "Before first review, docs/travel-reliability-closure.md contains
      the family proof plan and one copy-ready focused proof route, backed by
      committed fixtures and a uniquely titled integration test. Invariants: leg
      identity/order, no accidental duplicate identity, safe checklist
      retirement, unchanged photo bytes/format/links, atomic or honestly
      reported partial writes, add-only restore and sync convergence. List every
      reader/writer: Stop add/move/return, extraction/presence/backfill,
      review/retention/apply and its Plan/Prompt entry paths; List/Visited/Map,
      TripCover, needs/readiness, Insights, JournalView and exports;
      Stop/Moment/receipt/cover ingestion, galleries, downloads/share/ZIP,
      validation, both NAS download/restore paths, upload/check/listing and old
      clients/receivers. Cross the equivalence classes above, prove
      independently specified expected IDs/order/checklist sets/hashes and a
      negative control that exposes the original defect; record checked-clean
      consumers and limits. No assertions whose expected answer comes from the
      function under test."
    test: manual:Playwright journeys gate "travel reliability family proof preserves
      identities and originals across revision restore and sync" in
      tests/e2e/travel-reliability.spec.ts
  - id: ac-12
    description: Owner reviews the six-target disposition, final exact-patch
      Check/independent Review and concise visual evidence at existing mobile
      viewports. Standard Svelte/TypeScript, lint, unit, build, journeys and
      secrets gates must pass, plus formatting, production PWA update, PHP
      syntax and isolated real-PHP suites. Provide a short disposable-origin
      native iPhone Safari/standalone check for camera/library HEIC, original
      download, offline reading and the fixed larger selection using a test
      receiver. Owner records hardware results or explicitly accepts the
      unverified native limit through the established approval gate. Agents do
      not mark this manual check passed or use personal data/live NAS.
    test: manual:OWNER
docsDelta:
  - README.md
  - docs/nas-backup-setup.md
  - docs/travel-reliability-closure.md
createdAt: 2026-11-09T16:20:42.913Z
amendments:
  - at: 2026-11-09T18:23:22.459Z
    reason: "Check traces acceptance checks only through Vitest test names; ten
      named Playwright journeys pass but cannot be traced. ac-2, ac-3 and ac-7
      now trace to new Vitest proofs of their pure logic, and ac-5 to its
      existing one; their journeys still run in the journeys gate. ac-1, ac-6,
      ac-8, ac-9, ac-10 and ac-11 need IndexedDB, the UI, downloads or a PHP
      receiver, which Node Vitest cannot reach: each names its passing journey
      as its verifier. Descriptions are unchanged; only ac-12 needs the owner."
    description: 'checks: +ac-1|Manual addition after revised routes with off-route
      tails uses the chosen or evidenced current leg and a stable route
      position. Cover empty/all-retained routes, zero/one/multiple legs,
      Vienna–Salzburg–Vienna, gapped/tied orders and rapid additions. Existing
      IDs/history and an unrelated trip remain unchanged.|manual:Playwright
      journeys gate "manual Stops stay in the intended leg when retained records
      trail the itinerary" in tests/e2e/travel-reliability.spec.ts,
      ac-2|Distinguish no match from multiple plausible exact matches, including
      repeated city names and imported-name aliases. Known ambiguity needs an
      explicit reuse/new choice; deliberate same-name new places remain
      possible. Selected records retain their leg and history, each ID is used
      at most once, and cancellation writes nothing.|review separates ambiguous
      plan matches from no match and uses each record once, ac-3|Legacy
      extraction, candidate-presence checks, guide backfill and reviewed apply
      agree on safe repeated-city identity. Exercise Vienna–Salzburg–Vienna,
      identical names on different legs, an unassigned existing Stop,
      deleted/unknown legs, missing city headings, and repeated application. No
      arbitrary last-leg assignment, cross-leg backfill or multiplying
      duplicates; unknown placement stays explicit.|repeated-city plan logic
      never picks a leg a heading cannot name, ac-5|Preserve the already-fixed
      unchanged-plan repeated-city behaviour, including personal and
      returned-to-route Stops. Extend coverage only where necessary; do not
      weaken existing route-retention assertions.|re-applying the same plan to a
      trip that returns to a city changes nothing, ac-6|Keep atomic apply and
      stale-editor protection: changed plan, Stop or City during review is
      refused without overwriting the other writer; an unstructured paste
      preserves the route and cancellation retains the draft.|manual:Playwright
      journeys gate "a stale plan review refuses concurrent edits and an
      unstructured paste keeps the route" in
      tests/e2e/plan-capture-revision.spec.ts, ac-7|Use genuine format fixtures
      with documented provenance and independently known byte hashes, not text
      blobs merely labelled as images. HEIC/HEIF, JPEG, PNG and WebP originals
      retain bytes, metadata links and correct format through single downloads,
      manifest/share output and ZIP restore. Include legacy .jpg-labelled
      HEIC/HEIF, absent/wrong MIME, corrupt/unrecognised input, current/old
      backups, add-only restore and an unrelated trip.|ZIP restore reads HEIC
      and HEIF originals back byte for byte under any entry name, ac-8|In a
      browser without the required decoder, affected photo views give honest
      unavailable-preview feedback and a working original download; decode
      failure never deletes, transforms or prevents retaining an original. A
      known decodable image still opens normally. Check Stop and Moment
      galleries and directly affected cover/journal readers.|manual:Playwright
      journeys gate "undecodable photo previews keep the original available to
      save" in tests/e2e/travel-reliability.spec.ts, ac-9|Two isolated devices
      converge on revised routes, repeated legs, checklist provenance/results
      and mixed-format photo bytes through current, previous and original real
      PHP receivers. Include missing photo download/restore, existing historical
      jpg originals, interrupted/lost upload response, repeat idle sync and
      explicit tombstones. Assert hashes, links and IDs, no missing-file false
      success or duplicate original, no extra snapshots on idle. Frozen old
      receivers/readers remain unchanged.|manual:Playwright with real PHP
      receivers (CI) "revised routes and mixed photo formats converge through
      current and legacy NAS receivers" in tests/e2e/php-receiver.spec.ts,
      ac-10|Exercise Stop batches and new/existing Moment and receipt saves,
      with fixed mixed sizes/capture times, missing EXIF, a failure before first
      save and an injected mid-batch read/hash/write/quota error. Existing
      originals stay intact; report partial Stop success and retain/retry
      pending work without duplicates. New Moment/expense plus photos roll back
      together and preserve the draft. Document measured batch/concurrency
      results and any conservative limit.|manual:Playwright journeys gate "photo
      batch failures preserve committed records and retry without duplicating
      completed work" in tests/e2e/travel-reliability.spec.ts, ac-11|Before
      first review, docs/travel-reliability-closure.md contains the family proof
      plan and one copy-ready focused proof route, backed by committed fixtures
      and a uniquely titled integration test. Invariants: leg identity/order, no
      accidental duplicate identity, safe checklist retirement, unchanged photo
      bytes/format/links, atomic or honestly reported partial writes, add-only
      restore and sync convergence. List every reader/writer: Stop
      add/move/return, extraction/presence/backfill, review/retention/apply and
      its Plan/Prompt entry paths; List/Visited/Map, TripCover, needs/readiness,
      Insights, JournalView and exports; Stop/Moment/receipt/cover ingestion,
      galleries, downloads/share/ZIP, validation, both NAS download/restore
      paths, upload/check/listing and old clients/receivers. Cross the
      equivalence classes above, prove independently specified expected
      IDs/order/checklist sets/hashes and a negative control that exposes the
      original defect; record checked-clean consumers and limits. No assertions
      whose expected answer comes from the function under
      test.|manual:Playwright journeys gate "travel reliability family proof
      preserves identities and originals across revision restore and sync" in
      tests/e2e/travel-reliability.spec.ts -ac-1|Manual addition after revised
      routes with off-route tails uses the chosen or evidenced current leg and a
      stable route position. Cover empty/all-retained routes, zero/one/multiple
      legs, Vienna–Salzburg–Vienna, gapped/tied orders and rapid additions.
      Existing IDs/history and an unrelated trip remain unchanged.|manual Stops
      stay in the intended leg when retained records trail the itinerary,
      ac-2|Distinguish no match from multiple plausible exact matches, including
      repeated city names and imported-name aliases. Known ambiguity needs an
      explicit reuse/new choice; deliberate same-name new places remain
      possible. Selected records retain their leg and history, each ID is used
      at most once, and cancellation writes nothing.|ambiguous plan matches
      require a deliberate reuse or new-place decision, ac-3|Legacy extraction,
      candidate-presence checks, guide backfill and reviewed apply agree on safe
      repeated-city identity. Exercise Vienna–Salzburg–Vienna, identical names
      on different legs, an unassigned existing Stop, deleted/unknown legs,
      missing city headings, and repeated application. No arbitrary last-leg
      assignment, cross-leg backfill or multiplying duplicates; unknown
      placement stays explicit.|extraction and reviewed revisions never choose
      an arbitrary repeated-city leg, ac-5|Preserve the already-fixed
      unchanged-plan repeated-city behaviour, including personal and
      returned-to-route Stops. Extend coverage only where necessary; do not
      weaken existing route-retention assertions.|re-applying an unchanged plan
      to a trip that returns to a city changes nothing, ac-6|Keep atomic apply
      and stale-editor protection: changed plan, Stop or City during review is
      refused without overwriting the other writer; an unstructured paste
      preserves the route and cancellation retains the draft.|a stale plan
      review refuses concurrent edits and an unstructured paste keeps the route,
      ac-7|Use genuine format fixtures with documented provenance and
      independently known byte hashes, not text blobs merely labelled as images.
      HEIC/HEIF, JPEG, PNG and WebP originals retain bytes, metadata links and
      correct format through single downloads, manifest/share output and ZIP
      restore. Include legacy .jpg-labelled HEIC/HEIF, absent/wrong MIME,
      corrupt/unrecognised input, current/old backups, add-only restore and an
      unrelated trip.|HEIC and HEIF originals keep their bytes and format
      through downloads and ZIP restore, ac-8|In a browser without the required
      decoder, affected photo views give honest unavailable-preview feedback and
      a working original download; decode failure never deletes, transforms or
      prevents retaining an original. A known decodable image still opens
      normally. Check Stop and Moment galleries and directly affected
      cover/journal readers.|undecodable photo previews keep the original
      available to save, ac-9|Two isolated devices converge on revised routes,
      repeated legs, checklist provenance/results and mixed-format photo bytes
      through current, previous and original real PHP receivers. Include missing
      photo download/restore, existing historical jpg originals,
      interrupted/lost upload response, repeat idle sync and explicit
      tombstones. Assert hashes, links and IDs, no missing-file false success or
      duplicate original, no extra snapshots on idle. Frozen old
      receivers/readers remain unchanged.|revised routes and mixed photo formats
      converge through current and legacy NAS receivers, ac-10|Exercise Stop
      batches and new/existing Moment and receipt saves, with fixed mixed
      sizes/capture times, missing EXIF, a failure before first save and an
      injected mid-batch read/hash/write/quota error. Existing originals stay
      intact; report partial Stop success and retain/retry pending work without
      duplicates. New Moment/expense plus photos roll back together and preserve
      the draft. Document measured batch/concurrency results and any
      conservative limit.|photo batch failures preserve committed records and
      retry without duplicating completed work, ac-11|Before first review,
      docs/travel-reliability-closure.md contains the family proof plan and one
      copy-ready focused proof route, backed by committed fixtures and a
      uniquely titled integration test. Invariants: leg identity/order, no
      accidental duplicate identity, safe checklist retirement, unchanged photo
      bytes/format/links, atomic or honestly reported partial writes, add-only
      restore and sync convergence. List every reader/writer: Stop
      add/move/return, extraction/presence/backfill, review/retention/apply and
      its Plan/Prompt entry paths; List/Visited/Map, TripCover, needs/readiness,
      Insights, JournalView and exports; Stop/Moment/receipt/cover ingestion,
      galleries, downloads/share/ZIP, validation, both NAS download/restore
      paths, upload/check/listing and old clients/receivers. Cross the
      equivalence classes above, prove independently specified expected
      IDs/order/checklist sets/hashes and a negative control that exposes the
      original defect; record checked-clean consumers and limits. No assertions
      whose expected answer comes from the function under test.|travel
      reliability family proof preserves identities and originals across
      revision restore and sync'
---

# Close Stop, plan revision and photo reliability gaps

- **Issue:** https://github.com/ethan-ghoreishi/systema/issues/26
- **Risk tier:** heavy — auth, payments, saved data, schema/migrations — full checks, sealed review, a signed owner decision, and a tested rollback route
- **Baseline:** 8f57daae54927b0dfb610dbd4574b9dc5e8977b4 on main _(never re-baselined)_
- **Intent:** 20261109-close-stop-plan-revision-and-photo-relia-a0e7

## You may only change

- src/lib/stops.ts
- src/lib/plan-revision.ts
- src/lib/photos.ts
- src/lib/photo-format.ts
- src/lib/photo-batch.ts
- src/lib/export.ts
- src/lib/nas.svelte.ts
- src/lib/backup-validation.ts
- src/lib/db.ts
- src/lib/sync.ts
- src/components/tabs/StopsTab.svelte
- src/components/PlanRevision.svelte
- src/components/MomentCapture.svelte
- src/components/ExpenseCapture.svelte
- src/components/PhotoPicker.svelte
- src/components/PhotoGallery.svelte
- src/components/CoverPicker.svelte
- src/components/TripCover.svelte
- src/components/JournalView.svelte
- src/components/tabs/ExportTab.svelte
- nas/systema-backup.php
- README.md
- docs/nas-backup-setup.md
- docs/travel-reliability-closure.md
- tests/unit/stops.test.ts
- tests/unit/plan-revision.test.ts
- tests/unit/photos.test.ts
- tests/unit/export.test.ts
- tests/unit/backup-validation.test.ts
- tests/unit/compat.test.ts
- tests/unit/sync.test.ts
- tests/unit/travel-reliability.test.ts
- tests/e2e/plan-capture-revision.spec.ts
- tests/e2e/stops-travel.spec.ts
- tests/e2e/research.spec.ts
- tests/e2e/moments.spec.ts
- tests/e2e/data-safety.spec.ts
- tests/e2e/backup.spec.ts
- tests/e2e/sync.spec.ts
- tests/e2e/roundtrip.spec.ts
- tests/e2e/php-receiver.spec.ts
- tests/e2e/nas-fake.ts
- tests/e2e/travel-reliability.spec.ts
- tests/fixtures/reliability/sample.heic
- tests/fixtures/reliability/sample.heif
- tests/fixtures/reliability/sample.jpg
- tests/fixtures/reliability/sample.png
- tests/fixtures/reliability/sample.webp

## Never touch

- .github/**
- AGENTS.md
- CLAUDE.md
- package.json
- package-lock.json
- tests/unit/fixtures/old-backup-validation.ts
- tests/unit/fixtures/old-sync.ts
- tests/e2e/systema-backup-v1.php
- tests/e2e/systema-backup-v1.1.php

## Non-goals

- Preserve existing trip/Stop/City/Moment/expense IDs, visits and times, notes, pins, bookings, payment/FX links, original photo bytes/hashes and associations. Only the explicitly authorised safe retirement of obsolete generated checklist items may remove existing checklist content.
- Keep plans staged until atomic apply, reject stale reviews, retain omitted places/history and personal route additions, and preserve return-to-route placement and unchanged-plan idempotence from PRs 23–25.
- Keep IndexedDB/Dexie, offline capture and reading, optional NAS, add-only validated restore, explicit photo tombstones, merge/conflict semantics and historical backup compatibility. No destructive repair, storage clear, schema/version migration or mass rewrite.
- No accounts, runtime AI, paid services, new external data destinations, codec dependency or background conversion pipeline. Any optional metadata must validate and survive old/new readers and sync without forcing an upgrade.
- Use synthetic data and isolated browser contexts/temporary PHP receivers only. Native owner checks use a disposable origin/profile and test receiver, never the installed app database or live personal NAS. No canonical record hand edits, fabricated evidence, hook bypass, owner approvals or merge/release decisions by an agent.
- No retrospective deduplication, guessed leg reassignment, old-checklist mass pruning, automatic file transcoding or photo deletion. Unknown legacy checklist provenance always prevents automatic retirement.
- No itinerary/parser overhaul, fuzzy identity engine, new city-leg planning model, offline architecture change, thumbnail/cache subsystem, resumable background job framework, broad performance programme or unrelated UI redesign.
- Scope permission is a ceiling, not a requirement to edit every listed file. db.ts is available for minimal optional types only; sync.ts and receipt/cover/journal consumers only for direct family compatibility or failure handling. No payment, authentication, token or deployment behaviour changes. New helper and fixture paths are reserved options, not an instruction to create an abstraction or add every fixture.
- Native HEIC decoding everywhere, HEIF EXIF feature expansion and unlimited photo batch support are deferred. A memory redesign is deferred unless the fixed probe substantiates a failure; preserve and document a working bounded path instead.

## Acceptance checks (definition of done)

- [ ] **ac-1** — Manual addition after revised routes with off-route tails uses the chosen or evidenced current leg and a stable route position. Cover empty/all-retained routes, zero/one/multiple legs, Vienna–Salzburg–Vienna, gapped/tied orders and rapid additions. Existing IDs/history and an unrelated trip remain unchanged. _(proof: manual:Playwright journeys gate "manual Stops stay in the intended leg when retained records trail the itinerary" in tests/e2e/travel-reliability.spec.ts)_
- [ ] **ac-2** — Distinguish no match from multiple plausible exact matches, including repeated city names and imported-name aliases. Known ambiguity needs an explicit reuse/new choice; deliberate same-name new places remain possible. Selected records retain their leg and history, each ID is used at most once, and cancellation writes nothing. _(proof: review separates ambiguous plan matches from no match and uses each record once)_
- [ ] **ac-3** — Legacy extraction, candidate-presence checks, guide backfill and reviewed apply agree on safe repeated-city identity. Exercise Vienna–Salzburg–Vienna, identical names on different legs, an unassigned existing Stop, deleted/unknown legs, missing city headings, and repeated application. No arbitrary last-leg assignment, cross-leg backfill or multiplying duplicates; unknown placement stays explicit. _(proof: repeated-city plan logic never picks a leg a heading cannot name)_
- [ ] **ac-4** — Three revisions retire only established unchanged obsolete unchecked generated items. Completed, manual, edited, manually recreated and uncertain legacy items survive with stable IDs/ticks; retained source items are not duplicated. Include user deletion, missing planSource, same-text personal items and reapplication. Any new provenance survives validation, ZIP and old/new sync readers. _(proof: repeated plan revisions retire only proven untouched generated checklist items)_
- [ ] **ac-5** — Preserve the already-fixed unchanged-plan repeated-city behaviour, including personal and returned-to-route Stops. Extend coverage only where necessary; do not weaken existing route-retention assertions. _(proof: re-applying the same plan to a trip that returns to a city changes nothing)_
- [ ] **ac-6** — Keep atomic apply and stale-editor protection: changed plan, Stop or City during review is refused without overwriting the other writer; an unstructured paste preserves the route and cancellation retains the draft. _(proof: manual:Playwright journeys gate "a stale plan review refuses concurrent edits and an unstructured paste keeps the route" in tests/e2e/plan-capture-revision.spec.ts)_
- [ ] **ac-7** — Use genuine format fixtures with documented provenance and independently known byte hashes, not text blobs merely labelled as images. HEIC/HEIF, JPEG, PNG and WebP originals retain bytes, metadata links and correct format through single downloads, manifest/share output and ZIP restore. Include legacy .jpg-labelled HEIC/HEIF, absent/wrong MIME, corrupt/unrecognised input, current/old backups, add-only restore and an unrelated trip. _(proof: ZIP restore reads HEIC and HEIF originals back byte for byte under any entry name)_
- [ ] **ac-8** — In a browser without the required decoder, affected photo views give honest unavailable-preview feedback and a working original download; decode failure never deletes, transforms or prevents retaining an original. A known decodable image still opens normally. Check Stop and Moment galleries and directly affected cover/journal readers. _(proof: manual:Playwright journeys gate "undecodable photo previews keep the original available to save" in tests/e2e/travel-reliability.spec.ts)_
- [ ] **ac-9** — Two isolated devices converge on revised routes, repeated legs, checklist provenance/results and mixed-format photo bytes through current, previous and original real PHP receivers. Include missing photo download/restore, existing historical jpg originals, interrupted/lost upload response, repeat idle sync and explicit tombstones. Assert hashes, links and IDs, no missing-file false success or duplicate original, no extra snapshots on idle. Frozen old receivers/readers remain unchanged. _(proof: manual:Playwright with real PHP receivers (CI) "revised routes and mixed photo formats converge through current and legacy NAS receivers" in tests/e2e/php-receiver.spec.ts)_
- [ ] **ac-10** — Exercise Stop batches and new/existing Moment and receipt saves, with fixed mixed sizes/capture times, missing EXIF, a failure before first save and an injected mid-batch read/hash/write/quota error. Existing originals stay intact; report partial Stop success and retain/retry pending work without duplicates. New Moment/expense plus photos roll back together and preserve the draft. Document measured batch/concurrency results and any conservative limit. _(proof: manual:Playwright journeys gate "photo batch failures preserve committed records and retry without duplicating completed work" in tests/e2e/travel-reliability.spec.ts)_
- [ ] **ac-11** — Before first review, docs/travel-reliability-closure.md contains the family proof plan and one copy-ready focused proof route, backed by committed fixtures and a uniquely titled integration test. Invariants: leg identity/order, no accidental duplicate identity, safe checklist retirement, unchanged photo bytes/format/links, atomic or honestly reported partial writes, add-only restore and sync convergence. List every reader/writer: Stop add/move/return, extraction/presence/backfill, review/retention/apply and its Plan/Prompt entry paths; List/Visited/Map, TripCover, needs/readiness, Insights, JournalView and exports; Stop/Moment/receipt/cover ingestion, galleries, downloads/share/ZIP, validation, both NAS download/restore paths, upload/check/listing and old clients/receivers. Cross the equivalence classes above, prove independently specified expected IDs/order/checklist sets/hashes and a negative control that exposes the original defect; record checked-clean consumers and limits. No assertions whose expected answer comes from the function under test. _(proof: manual:Playwright journeys gate "travel reliability family proof preserves identities and originals across revision restore and sync" in tests/e2e/travel-reliability.spec.ts)_
- [ ] **ac-12** — Owner reviews the six-target disposition, final exact-patch Check/independent Review and concise visual evidence at existing mobile viewports. Standard Svelte/TypeScript, lint, unit, build, journeys and secrets gates must pass, plus formatting, production PWA update, PHP syntax and isolated real-PHP suites. Provide a short disposable-origin native iPhone Safari/standalone check for camera/library HEIC, original download, offline reading and the fixed larger selection using a test receiver. Owner records hardware results or explicitly accepts the unverified native limit through the established approval gate. Agents do not mark this manual check passed or use personal data/live NAS. _(proof: manual:OWNER)_

## Docs to update

- README.md
- docs/nas-backup-setup.md
- docs/travel-reliability-closure.md

## Amendments

- 2026-11-09T18:23:22.459Z — Check traces acceptance checks only through Vitest test names; ten named Playwright journeys pass but cannot be traced. ac-2, ac-3 and ac-7 now trace to new Vitest proofs of their pure logic, and ac-5 to its existing one; their journeys still run in the journeys gate. ac-1, ac-6, ac-8, ac-9, ac-10 and ac-11 need IndexedDB, the UI, downloads or a PHP receiver, which Node Vitest cannot reach: each names its passing journey as its verifier. Descriptions are unchanged; only ac-12 needs the owner.: checks: +ac-1|Manual addition after revised routes with off-route tails uses the chosen or evidenced current leg and a stable route position. Cover empty/all-retained routes, zero/one/multiple legs, Vienna–Salzburg–Vienna, gapped/tied orders and rapid additions. Existing IDs/history and an unrelated trip remain unchanged.|manual:Playwright journeys gate "manual Stops stay in the intended leg when retained records trail the itinerary" in tests/e2e/travel-reliability.spec.ts, ac-2|Distinguish no match from multiple plausible exact matches, including repeated city names and imported-name aliases. Known ambiguity needs an explicit reuse/new choice; deliberate same-name new places remain possible. Selected records retain their leg and history, each ID is used at most once, and cancellation writes nothing.|review separates ambiguous plan matches from no match and uses each record once, ac-3|Legacy extraction, candidate-presence checks, guide backfill and reviewed apply agree on safe repeated-city identity. Exercise Vienna–Salzburg–Vienna, identical names on different legs, an unassigned existing Stop, deleted/unknown legs, missing city headings, and repeated application. No arbitrary last-leg assignment, cross-leg backfill or multiplying duplicates; unknown placement stays explicit.|repeated-city plan logic never picks a leg a heading cannot name, ac-5|Preserve the already-fixed unchanged-plan repeated-city behaviour, including personal and returned-to-route Stops. Extend coverage only where necessary; do not weaken existing route-retention assertions.|re-applying the same plan to a trip that returns to a city changes nothing, ac-6|Keep atomic apply and stale-editor protection: changed plan, Stop or City during review is refused without overwriting the other writer; an unstructured paste preserves the route and cancellation retains the draft.|manual:Playwright journeys gate "a stale plan review refuses concurrent edits and an unstructured paste keeps the route" in tests/e2e/plan-capture-revision.spec.ts, ac-7|Use genuine format fixtures with documented provenance and independently known byte hashes, not text blobs merely labelled as images. HEIC/HEIF, JPEG, PNG and WebP originals retain bytes, metadata links and correct format through single downloads, manifest/share output and ZIP restore. Include legacy .jpg-labelled HEIC/HEIF, absent/wrong MIME, corrupt/unrecognised input, current/old backups, add-only restore and an unrelated trip.|ZIP restore reads HEIC and HEIF originals back byte for byte under any entry name, ac-8|In a browser without the required decoder, affected photo views give honest unavailable-preview feedback and a working original download; decode failure never deletes, transforms or prevents retaining an original. A known decodable image still opens normally. Check Stop and Moment galleries and directly affected cover/journal readers.|manual:Playwright journeys gate "undecodable photo previews keep the original available to save" in tests/e2e/travel-reliability.spec.ts, ac-9|Two isolated devices converge on revised routes, repeated legs, checklist provenance/results and mixed-format photo bytes through current, previous and original real PHP receivers. Include missing photo download/restore, existing historical jpg originals, interrupted/lost upload response, repeat idle sync and explicit tombstones. Assert hashes, links and IDs, no missing-file false success or duplicate original, no extra snapshots on idle. Frozen old receivers/readers remain unchanged.|manual:Playwright with real PHP receivers (CI) "revised routes and mixed photo formats converge through current and legacy NAS receivers" in tests/e2e/php-receiver.spec.ts, ac-10|Exercise Stop batches and new/existing Moment and receipt saves, with fixed mixed sizes/capture times, missing EXIF, a failure before first save and an injected mid-batch read/hash/write/quota error. Existing originals stay intact; report partial Stop success and retain/retry pending work without duplicates. New Moment/expense plus photos roll back together and preserve the draft. Document measured batch/concurrency results and any conservative limit.|manual:Playwright journeys gate "photo batch failures preserve committed records and retry without duplicating completed work" in tests/e2e/travel-reliability.spec.ts, ac-11|Before first review, docs/travel-reliability-closure.md contains the family proof plan and one copy-ready focused proof route, backed by committed fixtures and a uniquely titled integration test. Invariants: leg identity/order, no accidental duplicate identity, safe checklist retirement, unchanged photo bytes/format/links, atomic or honestly reported partial writes, add-only restore and sync convergence. List every reader/writer: Stop add/move/return, extraction/presence/backfill, review/retention/apply and its Plan/Prompt entry paths; List/Visited/Map, TripCover, needs/readiness, Insights, JournalView and exports; Stop/Moment/receipt/cover ingestion, galleries, downloads/share/ZIP, validation, both NAS download/restore paths, upload/check/listing and old clients/receivers. Cross the equivalence classes above, prove independently specified expected IDs/order/checklist sets/hashes and a negative control that exposes the original defect; record checked-clean consumers and limits. No assertions whose expected answer comes from the function under test.|manual:Playwright journeys gate "travel reliability family proof preserves identities and originals across revision restore and sync" in tests/e2e/travel-reliability.spec.ts -ac-1|Manual addition after revised routes with off-route tails uses the chosen or evidenced current leg and a stable route position. Cover empty/all-retained routes, zero/one/multiple legs, Vienna–Salzburg–Vienna, gapped/tied orders and rapid additions. Existing IDs/history and an unrelated trip remain unchanged.|manual Stops stay in the intended leg when retained records trail the itinerary, ac-2|Distinguish no match from multiple plausible exact matches, including repeated city names and imported-name aliases. Known ambiguity needs an explicit reuse/new choice; deliberate same-name new places remain possible. Selected records retain their leg and history, each ID is used at most once, and cancellation writes nothing.|ambiguous plan matches require a deliberate reuse or new-place decision, ac-3|Legacy extraction, candidate-presence checks, guide backfill and reviewed apply agree on safe repeated-city identity. Exercise Vienna–Salzburg–Vienna, identical names on different legs, an unassigned existing Stop, deleted/unknown legs, missing city headings, and repeated application. No arbitrary last-leg assignment, cross-leg backfill or multiplying duplicates; unknown placement stays explicit.|extraction and reviewed revisions never choose an arbitrary repeated-city leg, ac-5|Preserve the already-fixed unchanged-plan repeated-city behaviour, including personal and returned-to-route Stops. Extend coverage only where necessary; do not weaken existing route-retention assertions.|re-applying an unchanged plan to a trip that returns to a city changes nothing, ac-6|Keep atomic apply and stale-editor protection: changed plan, Stop or City during review is refused without overwriting the other writer; an unstructured paste preserves the route and cancellation retains the draft.|a stale plan review refuses concurrent edits and an unstructured paste keeps the route, ac-7|Use genuine format fixtures with documented provenance and independently known byte hashes, not text blobs merely labelled as images. HEIC/HEIF, JPEG, PNG and WebP originals retain bytes, metadata links and correct format through single downloads, manifest/share output and ZIP restore. Include legacy .jpg-labelled HEIC/HEIF, absent/wrong MIME, corrupt/unrecognised input, current/old backups, add-only restore and an unrelated trip.|HEIC and HEIF originals keep their bytes and format through downloads and ZIP restore, ac-8|In a browser without the required decoder, affected photo views give honest unavailable-preview feedback and a working original download; decode failure never deletes, transforms or prevents retaining an original. A known decodable image still opens normally. Check Stop and Moment galleries and directly affected cover/journal readers.|undecodable photo previews keep the original available to save, ac-9|Two isolated devices converge on revised routes, repeated legs, checklist provenance/results and mixed-format photo bytes through current, previous and original real PHP receivers. Include missing photo download/restore, existing historical jpg originals, interrupted/lost upload response, repeat idle sync and explicit tombstones. Assert hashes, links and IDs, no missing-file false success or duplicate original, no extra snapshots on idle. Frozen old receivers/readers remain unchanged.|revised routes and mixed photo formats converge through current and legacy NAS receivers, ac-10|Exercise Stop batches and new/existing Moment and receipt saves, with fixed mixed sizes/capture times, missing EXIF, a failure before first save and an injected mid-batch read/hash/write/quota error. Existing originals stay intact; report partial Stop success and retain/retry pending work without duplicates. New Moment/expense plus photos roll back together and preserve the draft. Document measured batch/concurrency results and any conservative limit.|photo batch failures preserve committed records and retry without duplicating completed work, ac-11|Before first review, docs/travel-reliability-closure.md contains the family proof plan and one copy-ready focused proof route, backed by committed fixtures and a uniquely titled integration test. Invariants: leg identity/order, no accidental duplicate identity, safe checklist retirement, unchanged photo bytes/format/links, atomic or honestly reported partial writes, add-only restore and sync convergence. List every reader/writer: Stop add/move/return, extraction/presence/backfill, review/retention/apply and its Plan/Prompt entry paths; List/Visited/Map, TripCover, needs/readiness, Insights, JournalView and exports; Stop/Moment/receipt/cover ingestion, galleries, downloads/share/ZIP, validation, both NAS download/restore paths, upload/check/listing and old clients/receivers. Cross the equivalence classes above, prove independently specified expected IDs/order/checklist sets/hashes and a negative control that exposes the original defect; record checked-clean consumers and limits. No assertions whose expected answer comes from the function under test.|travel reliability family proof preserves identities and originals across revision restore and sync


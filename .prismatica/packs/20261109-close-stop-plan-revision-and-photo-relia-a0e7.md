---
id: 20261109-close-stop-plan-revision-and-photo-relia-a0e7
contractId: 20261109-close-stop-plan-revision-and-photo-relia-a0e7
contractHash: 51272894bba7331b5bcb7e3375d784eddbf8c62d3f939b16f5856fbbe0ab9430
createdAt: 2026-11-09T18:23:55.209Z
skills:
  - ui-work
  - build
  - simplify
---

# Build brief: Close Stop, plan revision and photo reliability gaps

> This brief is scoped and self-contained. A fresh session can resume from it
> alone. Prismatica will check your work deterministically — it never reads this
> chat, only Git and your tests.

- **Linked issue:** https://github.com/ethan-ghoreishi/systema/issues/26
- **Risk tier:** heavy — auth, payments, saved data, schema/migrations — full checks, sealed review, a signed owner decision, and a tested rollback route
- **Work in the lane:** /Users/Ehsan/workspace/active/systema-lanes/20261109-close-stop-plan-revision-and-photo-relia-a0e7

## The plan the owner approved

This is the complete approved proposal, verbatim. `assumptions` and
`possibleConflicts` are the Planner's advisory reading — treat them as leads to
verify against the code, never as established fact.

````yaml
# Approved intent: Close Stop, plan revision and photo reliability gaps

The owner imported this plan and confirmed the change. Its approved meaning is
recorded here verbatim; the transport snapshot is deliberately omitted.

- **Kind:** existing-flow
- **Risk tier:** heavy
- **Builder:** claude

## What the owner asked for

This is the wording the owner and the planning agent settled on together, taken
from the plan itself — not a description reconstructed afterwards.

> Use Prismatica Start to plan a focused reliability and UX lane for Systema. Inspect the current repository and relevant history as a principal software engineer, code auditor and product UX strategist. Resolve the remaining substantiated issues with the smallest coherent changes, preserving existing functionality, simplicity and data integrity.
> 
> Independently investigate manual Stop city assignment and ordering after revisions with retained off-route Stops; ambiguous plan matches presented as new places; HEIC/HEIF preview, storage, downloads, ZIP backup/restore and NAS sync; repeated-city assignment in legacy extraction; accumulating plan-generated checklist items; and memory use when adding larger photo batches. These are investigation targets, not predetermined fixes. Challenge findings, distinguish confirmed defects from acceptable trade-offs, and defer speculative or low-value changes with reasons.
> 
> For checklist revisions: yes, retire only safely attributable untouched items. Never remove completed, manually added, edited or uncertain legacy items.
> 
> Prioritise correctness, user value and minimal friction over feature completeness. Preserve trips, visits, bookings, photos, Moments, local-first storage, offline use, NAS sync and historical compatibility. Avoid unrelated refactoring, unnecessary migrations, architectural expansion and cosmetic changes. Give Claude freedom to investigate and refine implementation approaches; specify desired behaviour and constraints rather than code. Define meaningful acceptance, edge cases and regression coverage, particularly for data preservation, repeated cities and sync. Resolve product and safety decisions upfront and delegate implementation judgement. Require substantive, reproducible review findings; distinguish blockers from preferences and avoid repeated speculative review cycles. Claude will build. Use Prismatica's established review and release gates. Close the remaining reliability gaps in one lane and return Systema to normal use, without an open-ended development cycle.

## Why

Main 8f57daa already includes PRs 23–25, including return-to-route placement and unchanged-plan idempotence. One bounded lane closes the remaining route-identity and original-photo handling gaps across existing journeys. Preserve those fixes and make uncertainty visible rather than add automatic guesses. Planning used local history, a matching remote main revision, caller/test inspection and synthetic in-memory source probes; it did not exercise a browser, real IndexedDB or a NAS.

## Today

Confirmed at 8f57daa:
1. StopsTab.addStopNow derives the city from the final saved Stop, including retained off-route records. addStop uses row count as order, which can collide with or precede surviving orders after deletions/reordering. The newer returnToRoute path already handles route placement separately.
2. planMatches safely refuses multiple exact candidates, but PlanRevision renders both ambiguity and no match as “New place” and allows Apply without a deliberate ambiguity decision. Existing manual matching and stale-review protection already work; arbitrary renamed places cannot reliably be identified automatically.
3. Legacy cityIds collapses repeated names to the last leg. A Vienna–Salzburg–Vienna extraction probe put both Vienna blocks on the second Vienna leg. matchStop/guideBackfill can consequently select or update the wrong leg; the newer review leaves new repeated-city candidates unassigned.
4. revisedStop appends new checklist texts and never retires obsolete generated items. A prior unchecked generated cue remained beside its replacement. planSource records candidate text, not per-item identity, so safe provenance must be demonstrated rather than assumed from similar wording.
5. photoRecord keeps original bytes and MIME. photoExt maps HEIC/HEIF to jpg; ZIP reading and current/previous PHP receivers recognise only JPEG, PNG and WebP. Thus originals can remain byte-intact while downloads, restored MIME and NAS responses misdescribe them. Gallery thumbnail decode errors already offer “Save the original”; universal HEIC decoding is not established.
6. addPhotos writes full images serially, whereas preparePhotos retains the prepared batch for atomic Moment/expense saves. Header reads use Promise.all: a 24-file probe started 24 header reads. An injected third-write failure left two Stop photos committed but no returned progress; StopsTab.onPhotos has no local failure feedback. These prove concurrency/partial-completion behaviour, not an out-of-memory crash or physical-iPhone limit.

## Instead

1. Manual Stops join the intended current route leg and appear in a stable, sensible route position. Retained history must not influence the default. With no usable route context, choose an explicit leg or leave the Stop unassigned rather than imply knowledge. Repeated city names must be distinguishable wherever this lane asks the traveller to select or match a leg. Keep ordinary entry quick; no mandatory multi-field form.
2. Review separates a genuinely unmatched new place from a known ambiguous match. Require a deliberate reuse-or-new decision only for known ambiguity; do not add routine confirmations for obvious matches or ordinary new places. Show enough leg/history context to choose. Never fuzzy-merge, reuse one Stop twice or silently transfer history between legs. Both legacy extraction/backfill and reviewed revisions must avoid arbitrary repeated-city assignment. A new Stop whose leg is genuinely unknown stays unassigned and can use existing correction controls. Existing records are not retrospectively reassigned by inference.
3. On revision, retire an obsolete unchecked item only when unchanged generated provenance is established. Preserve completed items, manual additions, edits, uncertain legacy items, surviving identities and tick state. A text resemblance alone is insufficient proof of origin. Use the existing source model where safe; minimal optional provenance is permitted if needed, with conservative behaviour for old records. Reapplying a plan is idempotent. Preserve the existing manual checklist controls.
4. Preserve HEIC/HEIF originals and existing JPEG/PNG/WebP behaviour end to end: capture, local reading, single-photo download, manifest/share export, ZIP backup/restore and optional NAS sync/restore. Correctly identify supported originals even when historical .jpg names or missing/wrong MIME obscure them, without rewriting photo bytes or requiring a bulk repair. Unrecognised/undecodable input must remain safely recoverable with honest feedback. Preview may depend on native decoder support; when unavailable, provide a usable save-original fallback in affected viewing paths. Do not make universal HEIC decoding or conversion a release requirement. Preserve old backups, metadata without new fields and old receiver interoperability; no mandatory NAS upgrade. Explain actual old-client display limits.
5. Make photo work safe under ordinary larger selections and injected read/hash/write/quota failures. Preserve capture ordering, originals, existing records and draft text. Show what saved and what remains; retry must not duplicate the already committed part of a selection. New Moment/expense records and their photos retain atomic save semantics. Reuse existing ingestion and storage; choose the smallest complete error/retry handling. Before changing memory architecture, run a fixed synthetic baseline, initially 24 photos of 5 MiB plus one 20 MiB photo, recording sizes, concurrency and observed completion/responsiveness in Chromium/WebKit. If a minimal mitigation is needed, prove it against that route. A reliable measured path can remain unchanged; do not promise unlimited batches or infer a device memory ceiling from desktop tests.
6. Claude owns implementation choices, helper placement, test organisation, any minimal optional metadata and whether evidence justifies a memory mitigation or PHP format change. Read all callers first. Before first review, complete the family proof route below and record a disposition for all six targets: fixed, already safe or explicitly deferred with evidence. Reconcile affected existing Flow descriptions through Prismatica's proposal/approval protocol only when behaviour changes. Primary Flow is research-and-revise-trip-plan; affected neighbours are follow-stops-and-record-visits, capture-moments-and-photos, export-trip-and-save-journal, back-up-and-restore-device and sync-devices-and-resolve-conflicts.
7. Finish through the generated lane brief and authoritative prismatica open/next actions, established Check and independent patch-bound Review, then owner seal/acceptance and normal merge/release gates. Review the complete final patch and connected consumers once; further review follows substantive fixes, new evidence or a changed patch. Blockers need a reproducible route, expected/actual state, affected invariant and concrete user/data impact. Preferences, hypothetical scale problems and absent optional enhancements are non-blocking. No arbitrary review-round limit excuses a real blocker. Once gates pass, confirmed gaps are closed and explicit limitations are accepted by the owner, stop; no extra product backlog or speculative redesign. Do not merge, deploy, contact the live NAS or operate the installed app as part of this build.

## Advisory — the planning agent's reading, not established fact

The two lists below are the planning agent's interpretation. Deterministic code
checked that this plan is complete, in scope, correctly bound, and correctly
tiered; it did not and cannot check whether this reading of the app is right.
Verify them against the code.

**Assumptions**

- A1: The six targets bound this closure lane; unrelated issues are reported separately only if substantive and do not silently widen implementation.
- A2: Unknown repeated-city leg and unsupported preview are acceptable visible states when the alternative would guess history or transform originals. Existing wrong assignments require explicit user correction, not automatic repair.
- A3: Photo batch size is an evidence fixture, not a new product quota or a claim about native memory. Hardware checks remain owner evidence; automated WebKit is not physical iPhone verification.

**Possible conflicts**

- Checklist cleanup conflicts with history preservation when provenance is missing. Retain the uncertain item; if existing source text cannot establish origin, use only minimal forward provenance or defer cleanup of those records. Do not label manually recreated or edited text as disposable merely because it resembles the plan.
- Changing only photoExt or the current PHP allowlist will not repair old JPEG-labelled originals or old receivers. Prove the whole reader/writer family, including legacy names/MIME and duplicate remote filenames for one ID if the chosen implementation can create them; keep credentials, auth and receiver transport unchanged.
- Prepared-batch memory buys atomic creation. Do not replace it with partial parent/attachment saves or a durable ingestion subsystem merely to reduce a theoretical peak; justify any mitigation with the fixed probe and retain recoverable drafts.
- Correct matching is more valuable than automatic completeness. Keep intentional same-name places possible with an explicit new-place choice, and make repeated-leg labels distinguishable without inventing city dates or assuming the first/last occurrence.

## The complete approved plan

```json
{
  "format": "prismatica/start@1",
  "request": "Use Prismatica Start to plan a focused reliability and UX lane for Systema. Inspect the current repository and relevant history as a principal software engineer, code auditor and product UX strategist. Resolve the remaining substantiated issues with the smallest coherent changes, preserving existing functionality, simplicity and data integrity.\n\nIndependently investigate manual Stop city assignment and ordering after revisions with retained off-route Stops; ambiguous plan matches presented as new places; HEIC/HEIF preview, storage, downloads, ZIP backup/restore and NAS sync; repeated-city assignment in legacy extraction; accumulating plan-generated checklist items; and memory use when adding larger photo batches. These are investigation targets, not predetermined fixes. Challenge findings, distinguish confirmed defects from acceptable trade-offs, and defer speculative or low-value changes with reasons.\n\nFor checklist revisions: yes, retire only safely attributable untouched items. Never remove completed, manually added, edited or uncertain legacy items.\n\nPrioritise correctness, user value and minimal friction over feature completeness. Preserve trips, visits, bookings, photos, Moments, local-first storage, offline use, NAS sync and historical compatibility. Avoid unrelated refactoring, unnecessary migrations, architectural expansion and cosmetic changes. Give Claude freedom to investigate and refine implementation approaches; specify desired behaviour and constraints rather than code. Define meaningful acceptance, edge cases and regression coverage, particularly for data preservation, repeated cities and sync. Resolve product and safety decisions upfront and delegate implementation judgement. Require substantive, reproducible review findings; distinguish blockers from preferences and avoid repeated speculative review cycles. Claude will build. Use Prismatica's established review and release gates. Close the remaining reliability gaps in one lane and return Systema to normal use, without an open-ended development cycle.",
  "builder": "claude",
  "summary": "Close Stop, plan revision and photo reliability gaps",
  "rationale": "Main 8f57daa already includes PRs 23–25, including return-to-route placement and unchanged-plan idempotence. One bounded lane closes the remaining route-identity and original-photo handling gaps across existing journeys. Preserve those fixes and make uncertainty visible rather than add automatic guesses. Planning used local history, a matching remote main revision, caller/test inspection and synthetic in-memory source probes; it did not exercise a browser, real IndexedDB or a NAS.",
  "kind": "existing-flow",
  "flowId": "research-and-revise-trip-plan",
  "currentBehaviour": "Confirmed at 8f57daa:\n1. StopsTab.addStopNow derives the city from the final saved Stop, including retained off-route records. addStop uses row count as order, which can collide with or precede surviving orders after deletions/reordering. The newer returnToRoute path already handles route placement separately.\n2. planMatches safely refuses multiple exact candidates, but PlanRevision renders both ambiguity and no match as “New place” and allows Apply without a deliberate ambiguity decision. Existing manual matching and stale-review protection already work; arbitrary renamed places cannot reliably be identified automatically.\n3. Legacy cityIds collapses repeated names to the last leg. A Vienna–Salzburg–Vienna extraction probe put both Vienna blocks on the second Vienna leg. matchStop/guideBackfill can consequently select or update the wrong leg; the newer review leaves new repeated-city candidates unassigned.\n4. revisedStop appends new checklist texts and never retires obsolete generated items. A prior unchecked generated cue remained beside its replacement. planSource records candidate text, not per-item identity, so safe provenance must be demonstrated rather than assumed from similar wording.\n5. photoRecord keeps original bytes and MIME. photoExt maps HEIC/HEIF to jpg; ZIP reading and current/previous PHP receivers recognise only JPEG, PNG and WebP. Thus originals can remain byte-intact while downloads, restored MIME and NAS responses misdescribe them. Gallery thumbnail decode errors already offer “Save the original”; universal HEIC decoding is not established.\n6. addPhotos writes full images serially, whereas preparePhotos retains the prepared batch for atomic Moment/expense saves. Header reads use Promise.all: a 24-file probe started 24 header reads. An injected third-write failure left two Stop photos committed but no returned progress; StopsTab.onPhotos has no local failure feedback. These prove concurrency/partial-completion behaviour, not an out-of-memory crash or physical-iPhone limit.",
  "desiredBehaviour": "1. Manual Stops join the intended current route leg and appear in a stable, sensible route position. Retained history must not influence the default. With no usable route context, choose an explicit leg or leave the Stop unassigned rather than imply knowledge. Repeated city names must be distinguishable wherever this lane asks the traveller to select or match a leg. Keep ordinary entry quick; no mandatory multi-field form.\n2. Review separates a genuinely unmatched new place from a known ambiguous match. Require a deliberate reuse-or-new decision only for known ambiguity; do not add routine confirmations for obvious matches or ordinary new places. Show enough leg/history context to choose. Never fuzzy-merge, reuse one Stop twice or silently transfer history between legs. Both legacy extraction/backfill and reviewed revisions must avoid arbitrary repeated-city assignment. A new Stop whose leg is genuinely unknown stays unassigned and can use existing correction controls. Existing records are not retrospectively reassigned by inference.\n3. On revision, retire an obsolete unchecked item only when unchanged generated provenance is established. Preserve completed items, manual additions, edits, uncertain legacy items, surviving identities and tick state. A text resemblance alone is insufficient proof of origin. Use the existing source model where safe; minimal optional provenance is permitted if needed, with conservative behaviour for old records. Reapplying a plan is idempotent. Preserve the existing manual checklist controls.\n4. Preserve HEIC/HEIF originals and existing JPEG/PNG/WebP behaviour end to end: capture, local reading, single-photo download, manifest/share export, ZIP backup/restore and optional NAS sync/restore. Correctly identify supported originals even when historical .jpg names or missing/wrong MIME obscure them, without rewriting photo bytes or requiring a bulk repair. Unrecognised/undecodable input must remain safely recoverable with honest feedback. Preview may depend on native decoder support; when unavailable, provide a usable save-original fallback in affected viewing paths. Do not make universal HEIC decoding or conversion a release requirement. Preserve old backups, metadata without new fields and old receiver interoperability; no mandatory NAS upgrade. Explain actual old-client display limits.\n5. Make photo work safe under ordinary larger selections and injected read/hash/write/quota failures. Preserve capture ordering, originals, existing records and draft text. Show what saved and what remains; retry must not duplicate the already committed part of a selection. New Moment/expense records and their photos retain atomic save semantics. Reuse existing ingestion and storage; choose the smallest complete error/retry handling. Before changing memory architecture, run a fixed synthetic baseline, initially 24 photos of 5 MiB plus one 20 MiB photo, recording sizes, concurrency and observed completion/responsiveness in Chromium/WebKit. If a minimal mitigation is needed, prove it against that route. A reliable measured path can remain unchanged; do not promise unlimited batches or infer a device memory ceiling from desktop tests.\n6. Claude owns implementation choices, helper placement, test organisation, any minimal optional metadata and whether evidence justifies a memory mitigation or PHP format change. Read all callers first. Before first review, complete the family proof route below and record a disposition for all six targets: fixed, already safe or explicitly deferred with evidence. Reconcile affected existing Flow descriptions through Prismatica's proposal/approval protocol only when behaviour changes. Primary Flow is research-and-revise-trip-plan; affected neighbours are follow-stops-and-record-visits, capture-moments-and-photos, export-trip-and-save-journal, back-up-and-restore-device and sync-devices-and-resolve-conflicts.\n7. Finish through the generated lane brief and authoritative prismatica open/next actions, established Check and independent patch-bound Review, then owner seal/acceptance and normal merge/release gates. Review the complete final patch and connected consumers once; further review follows substantive fixes, new evidence or a changed patch. Blockers need a reproducible route, expected/actual state, affected invariant and concrete user/data impact. Preferences, hypothetical scale problems and absent optional enhancements are non-blocking. No arbitrary review-round limit excuses a real blocker. Once gates pass, confirmed gaps are closed and explicit limitations are accepted by the owner, stop; no extra product backlog or speculative redesign. Do not merge, deploy, contact the live NAS or operate the installed app as part of this build.",
  "mustNotChange": [
    "Preserve existing trip/Stop/City/Moment/expense IDs, visits and times, notes, pins, bookings, payment/FX links, original photo bytes/hashes and associations. Only the explicitly authorised safe retirement of obsolete generated checklist items may remove existing checklist content.",
    "Keep plans staged until atomic apply, reject stale reviews, retain omitted places/history and personal route additions, and preserve return-to-route placement and unchanged-plan idempotence from PRs 23–25.",
    "Keep IndexedDB/Dexie, offline capture and reading, optional NAS, add-only validated restore, explicit photo tombstones, merge/conflict semantics and historical backup compatibility. No destructive repair, storage clear, schema/version migration or mass rewrite.",
    "No accounts, runtime AI, paid services, new external data destinations, codec dependency or background conversion pipeline. Any optional metadata must validate and survive old/new readers and sync without forcing an upgrade.",
    "Use synthetic data and isolated browser contexts/temporary PHP receivers only. Native owner checks use a disposable origin/profile and test receiver, never the installed app database or live personal NAS. No canonical record hand edits, fabricated evidence, hook bypass, owner approvals or merge/release decisions by an agent."
  ],
  "assumptions": [
    "A1: The six targets bound this closure lane; unrelated issues are reported separately only if substantive and do not silently widen implementation.",
    "A2: Unknown repeated-city leg and unsupported preview are acceptable visible states when the alternative would guess history or transform originals. Existing wrong assignments require explicit user correction, not automatic repair.",
    "A3: Photo batch size is an evidence fixture, not a new product quota or a claim about native memory. Hardware checks remain owner evidence; automated WebKit is not physical iPhone verification."
  ],
  "possibleConflicts": [
    "Checklist cleanup conflicts with history preservation when provenance is missing. Retain the uncertain item; if existing source text cannot establish origin, use only minimal forward provenance or defer cleanup of those records. Do not label manually recreated or edited text as disposable merely because it resembles the plan.",
    "Changing only photoExt or the current PHP allowlist will not repair old JPEG-labelled originals or old receivers. Prove the whole reader/writer family, including legacy names/MIME and duplicate remote filenames for one ID if the chosen implementation can create them; keep credentials, auth and receiver transport unchanged.",
    "Prepared-batch memory buys atomic creation. Do not replace it with partial parent/attachment saves or a durable ingestion subsystem merely to reduce a theoretical peak; justify any mitigation with the fixed probe and retain recoverable drafts.",
    "Correct matching is more valuable than automatic completeness. Keep intentional same-name places possible with an explicit new-place choice, and make repeated-leg labels distinguishable without inventing city dates or assuming the first/last occurrence."
  ],
  "scope": {
    "allow": [
      "src/lib/stops.ts",
      "src/lib/plan-revision.ts",
      "src/lib/photos.ts",
      "src/lib/photo-format.ts",
      "src/lib/photo-batch.ts",
      "src/lib/export.ts",
      "src/lib/nas.svelte.ts",
      "src/lib/backup-validation.ts",
      "src/lib/db.ts",
      "src/lib/sync.ts",
      "src/components/tabs/StopsTab.svelte",
      "src/components/PlanRevision.svelte",
      "src/components/MomentCapture.svelte",
      "src/components/ExpenseCapture.svelte",
      "src/components/PhotoPicker.svelte",
      "src/components/PhotoGallery.svelte",
      "src/components/CoverPicker.svelte",
      "src/components/TripCover.svelte",
      "src/components/JournalView.svelte",
      "src/components/tabs/ExportTab.svelte",
      "nas/systema-backup.php",
      "README.md",
      "docs/nas-backup-setup.md",
      "docs/travel-reliability-closure.md",
      "tests/unit/stops.test.ts",
      "tests/unit/plan-revision.test.ts",
      "tests/unit/photos.test.ts",
      "tests/unit/export.test.ts",
      "tests/unit/backup-validation.test.ts",
      "tests/unit/compat.test.ts",
      "tests/unit/sync.test.ts",
      "tests/unit/travel-reliability.test.ts",
      "tests/e2e/plan-capture-revision.spec.ts",
      "tests/e2e/stops-travel.spec.ts",
      "tests/e2e/research.spec.ts",
      "tests/e2e/moments.spec.ts",
      "tests/e2e/data-safety.spec.ts",
      "tests/e2e/backup.spec.ts",
      "tests/e2e/sync.spec.ts",
      "tests/e2e/roundtrip.spec.ts",
      "tests/e2e/php-receiver.spec.ts",
      "tests/e2e/nas-fake.ts",
      "tests/e2e/travel-reliability.spec.ts",
      "tests/fixtures/reliability/sample.heic",
      "tests/fixtures/reliability/sample.heif",
      "tests/fixtures/reliability/sample.jpg",
      "tests/fixtures/reliability/sample.png",
      "tests/fixtures/reliability/sample.webp"
    ],
    "forbid": [
      ".github/**",
      "AGENTS.md",
      "CLAUDE.md",
      "package.json",
      "package-lock.json",
      "tests/unit/fixtures/old-backup-validation.ts",
      "tests/unit/fixtures/old-sync.ts",
      "tests/e2e/systema-backup-v1.php",
      "tests/e2e/systema-backup-v1.1.php"
    ]
  },
  "exclusions": [
    "No retrospective deduplication, guessed leg reassignment, old-checklist mass pruning, automatic file transcoding or photo deletion. Unknown legacy checklist provenance always prevents automatic retirement.",
    "No itinerary/parser overhaul, fuzzy identity engine, new city-leg planning model, offline architecture change, thumbnail/cache subsystem, resumable background job framework, broad performance programme or unrelated UI redesign.",
    "Scope permission is a ceiling, not a requirement to edit every listed file. db.ts is available for minimal optional types only; sync.ts and receipt/cover/journal consumers only for direct family compatibility or failure handling. No payment, authentication, token or deployment behaviour changes. New helper and fixture paths are reserved options, not an instruction to create an abstraction or add every fixture.",
    "Native HEIC decoding everywhere, HEIF EXIF feature expansion and unlimited photo batch support are deferred. A memory redesign is deferred unless the fixed probe substantiates a failure; preserve and document a working bounded path instead."
  ],
  "acceptance": [
    {
      "description": "Manual addition after revised routes with off-route tails uses the chosen or evidenced current leg and a stable route position. Cover empty/all-retained routes, zero/one/multiple legs, Vienna–Salzburg–Vienna, gapped/tied orders and rapid additions. Existing IDs/history and an unrelated trip remain unchanged.",
      "test": "manual Stops stay in the intended leg when retained records trail the itinerary"
    },
    {
      "description": "Distinguish no match from multiple plausible exact matches, including repeated city names and imported-name aliases. Known ambiguity needs an explicit reuse/new choice; deliberate same-name new places remain possible. Selected records retain their leg and history, each ID is used at most once, and cancellation writes nothing.",
      "test": "ambiguous plan matches require a deliberate reuse or new-place decision"
    },
    {
      "description": "Legacy extraction, candidate-presence checks, guide backfill and reviewed apply agree on safe repeated-city identity. Exercise Vienna–Salzburg–Vienna, identical names on different legs, an unassigned existing Stop, deleted/unknown legs, missing city headings, and repeated application. No arbitrary last-leg assignment, cross-leg backfill or multiplying duplicates; unknown placement stays explicit.",
      "test": "extraction and reviewed revisions never choose an arbitrary repeated-city leg"
    },
    {
      "description": "Three revisions retire only established unchanged obsolete unchecked generated items. Completed, manual, edited, manually recreated and uncertain legacy items survive with stable IDs/ticks; retained source items are not duplicated. Include user deletion, missing planSource, same-text personal items and reapplication. Any new provenance survives validation, ZIP and old/new sync readers.",
      "test": "repeated plan revisions retire only proven untouched generated checklist items"
    },
    {
      "description": "Preserve the already-fixed unchanged-plan repeated-city behaviour, including personal and returned-to-route Stops. Extend coverage only where necessary; do not weaken existing route-retention assertions.",
      "test": "re-applying an unchanged plan to a trip that returns to a city changes nothing"
    },
    {
      "description": "Keep atomic apply and stale-editor protection: changed plan, Stop or City during review is refused without overwriting the other writer; an unstructured paste preserves the route and cancellation retains the draft.",
      "test": "a stale plan review refuses concurrent edits and an unstructured paste keeps the route"
    },
    {
      "description": "Use genuine format fixtures with documented provenance and independently known byte hashes, not text blobs merely labelled as images. HEIC/HEIF, JPEG, PNG and WebP originals retain bytes, metadata links and correct format through single downloads, manifest/share output and ZIP restore. Include legacy .jpg-labelled HEIC/HEIF, absent/wrong MIME, corrupt/unrecognised input, current/old backups, add-only restore and an unrelated trip.",
      "test": "HEIC and HEIF originals keep their bytes and format through downloads and ZIP restore"
    },
    {
      "description": "In a browser without the required decoder, affected photo views give honest unavailable-preview feedback and a working original download; decode failure never deletes, transforms or prevents retaining an original. A known decodable image still opens normally. Check Stop and Moment galleries and directly affected cover/journal readers.",
      "test": "undecodable photo previews keep the original available to save"
    },
    {
      "description": "Two isolated devices converge on revised routes, repeated legs, checklist provenance/results and mixed-format photo bytes through current, previous and original real PHP receivers. Include missing photo download/restore, existing historical jpg originals, interrupted/lost upload response, repeat idle sync and explicit tombstones. Assert hashes, links and IDs, no missing-file false success or duplicate original, no extra snapshots on idle. Frozen old receivers/readers remain unchanged.",
      "test": "revised routes and mixed photo formats converge through current and legacy NAS receivers"
    },
    {
      "description": "Exercise Stop batches and new/existing Moment and receipt saves, with fixed mixed sizes/capture times, missing EXIF, a failure before first save and an injected mid-batch read/hash/write/quota error. Existing originals stay intact; report partial Stop success and retain/retry pending work without duplicates. New Moment/expense plus photos roll back together and preserve the draft. Document measured batch/concurrency results and any conservative limit.",
      "test": "photo batch failures preserve committed records and retry without duplicating completed work"
    },
    {
      "description": "Before first review, docs/travel-reliability-closure.md contains the family proof plan and one copy-ready focused proof route, backed by committed fixtures and a uniquely titled integration test. Invariants: leg identity/order, no accidental duplicate identity, safe checklist retirement, unchanged photo bytes/format/links, atomic or honestly reported partial writes, add-only restore and sync convergence. List every reader/writer: Stop add/move/return, extraction/presence/backfill, review/retention/apply and its Plan/Prompt entry paths; List/Visited/Map, TripCover, needs/readiness, Insights, JournalView and exports; Stop/Moment/receipt/cover ingestion, galleries, downloads/share/ZIP, validation, both NAS download/restore paths, upload/check/listing and old clients/receivers. Cross the equivalence classes above, prove independently specified expected IDs/order/checklist sets/hashes and a negative control that exposes the original defect; record checked-clean consumers and limits. No assertions whose expected answer comes from the function under test.",
      "test": "travel reliability family proof preserves identities and originals across revision restore and sync"
    },
    {
      "description": "Owner reviews the six-target disposition, final exact-patch Check/independent Review and concise visual evidence at existing mobile viewports. Standard Svelte/TypeScript, lint, unit, build, journeys and secrets gates must pass, plus formatting, production PWA update, PHP syntax and isolated real-PHP suites. Provide a short disposable-origin native iPhone Safari/standalone check for camera/library HEIC, original download, offline reading and the fixed larger selection using a test receiver. Owner records hardware results or explicitly accepts the unverified native limit through the established approval gate. Agents do not mark this manual check passed or use personal data/live NAS.",
      "test": "manual:OWNER"
    }
  ],
  "risk": {
    "touchesAuth": false,
    "touchesPayments": false,
    "touchesSavedData": true,
    "copyOnly": false,
    "rationale": "Saved Stop identity, leg/order, generated checklist retirement and photo format/attachment writes cross IndexedDB, backup and NAS boundaries. Heavy review is expected from repository path rules. Receipt UI is in scope only for shared photo handling; payment and authentication semantics are excluded."
  },
  "delta": {
    "step": 3,
    "today": "Review safely retains records, but known ambiguity looks like a new place, legacy extraction can choose the last repeated-city leg and all old generated checklist items persist. Adjacent Stop/photo paths can misplace new entries or misdescribe originals and partial saves.",
    "instead": "Review distinguishes ambiguity and requires its deliberate resolution, applies identity-safe revisions with conservative generated-checklist retirement, and preserves the route/history and original-photo guarantees across the connected Stop, export, restore and sync paths.",
    "keep": [
      "Staged plan and atomic apply with stale-review refusal",
      "Stable existing record identity, personal edits, visits, bookings, photos and linked Moments",
      "Simple ordinary capture, offline storage, optional NAS and historical compatibility"
    ],
    "assumptions": [],
    "showMe": "Run the focused fixture proof route documented in docs/travel-reliability-closure.md, including repeated-city ambiguity, safe versus forbidden checklist retirement, legacy photo formats, partial batch failure, ZIP restore and two-device real-PHP convergence; then use the established owner approval and release gates."
  },
  "desiredRules": [],
  "docsDelta": [
    "README.md",
    "docs/nas-backup-setup.md",
    "docs/travel-reliability-closure.md"
  ]
}
```
````

## The approved Delta this change must deliver

# Review distinguishes ambiguity and requires its deliberate resolution, applies identity-safe revisions with conservative generated-checklist retirement, and preserves the route/history and original-photo guarantees across the connected Stop, export, restore and sync paths.

_approved · about "research-and-revise-trip-plan" step 3_

## Today

Review safely retains records, but known ambiguity looks like a new place, legacy extraction can choose the last repeated-city leg and all old generated checklist items persist. Adjacent Stop/photo paths can misplace new entries or misdescribe originals and partial saves.

## Instead

Review distinguishes ambiguity and requires its deliberate resolution, applies identity-safe revisions with conservative generated-checklist retirement, and preserves the route/history and original-photo guarantees across the connected Stop, export, restore and sync paths.

## Keep

- Staged plan and atomic apply with stale-review refusal
- Stable existing record identity, personal edits, visits, bookings, photos and linked Moments
- Simple ordinary capture, offline storage, optional NAS and historical compatibility

## New assumptions

_none_

## Show me

Run the focused fixture proof route documented in docs/travel-reliability-closure.md, including repeated-city ambiguity, safe versus forbidden checklist retirement, legacy photo formats, partial batch failure, ZIP restore and two-device real-PHP convergence; then use the established owner approval and release gates.


## Flows near this scope (understand before you change them)

Compact cards — read a Flow's canonical file when your change touches it.

- **Back up and restore a device** (`back-up-and-restore-device`) — Download a full backup and restore missing records without replacing existing work.
  touchpoints: `src/routes/Settings.svelte`, `src/lib/export.ts`, `src/lib/backup-validation.ts`, `src/lib/zip.ts`, `src/lib/photos.ts`, `src/lib/db.ts` · canonical: `.prismatica/flows/back-up-and-restore-device.md`
- **Capture a Moment** (`capture-moments-and-photos`) — Keep an encounter or event with optional time, place, Stop link and photographs.
  touchpoints: `src/components/MomentCapture.svelte`, `src/components/tabs/StopsTab.svelte`, `src/components/PhotoGallery.svelte`, `src/lib/moments.ts`, `src/lib/photos.ts`, `src/lib/exif.ts`, `src/lib/tz.ts`, `src/lib/db.ts` · canonical: `.prismatica/flows/capture-moments-and-photos.md`
- **Compare recorded travel costs** (`compare-travel-costs`) — Compare saved city costs and travel patterns with the evidence limits visible.
  touchpoints: `src/routes/Insights.svelte`, `src/routes/Home.svelte`, `src/lib/insights.ts`, `src/lib/csv.ts`, `src/lib/download.ts`, `src/lib/db.ts` · canonical: `.prismatica/flows/compare-travel-costs.md`
- **Compare options and choose a trip** (`consider-destinations-and-choose-trip`) — Turn destination research and travel options into a trip while retaining alternatives.
  touchpoints: `src/routes/Home.svelte`, `src/routes/Opportunity.svelte`, `src/components/FinderImport.svelte`, `src/components/OptionEditor.svelte`, `src/lib/options.ts`, `src/lib/opportunities.ts`, `src/lib/insights.ts`, `src/lib/db.ts` · canonical: `.prismatica/flows/consider-destinations-and-choose-trip.md`
- **Create and edit a trip** (`create-and-edit-trip`) — Keep a trip, its city legs, dates and departure details on the device.
  touchpoints: `src/routes/NewTrip.svelte`, `src/routes/TripEdit.svelte`, `src/routes/Trip.svelte`, `src/components/DepartureEditor.svelte`, `src/lib/trips.ts`, `src/lib/presets.ts`, `src/lib/trip-shape.ts`, `src/lib/tz.ts`, `src/lib/db.ts` · canonical: `.prismatica/flows/create-and-edit-trip.md`
- **Export a trip and save its journal** (`export-trip-and-save-journal`) — Take records out of Systema and keep a finished journal with the trip.
  touchpoints: `src/components/tabs/ExportTab.svelte`, `src/components/tabs/PlanTab.svelte`, `src/components/JournalView.svelte`, `src/lib/export.ts`, `src/lib/csv.ts`, `src/lib/journal.ts`, `src/lib/markdown.ts`, `src/lib/download.ts`, `src/lib/copy.svelte.ts`, `src/lib/db.ts` · canonical: `.prismatica/flows/export-trip-and-save-journal.md`
- **Follow Stops and record visits** (`follow-stops-and-record-visits`) — Use the planned route while keeping a separate record of actual visits.
  touchpoints: `src/components/tabs/StopsTab.svelte`, `src/components/StopsMap.svelte`, `src/components/PhotoGallery.svelte`, `src/components/PhotoPicker.svelte`, `src/lib/stops.ts`, `src/lib/maps.ts`, `src/lib/photos.ts`, `src/lib/moments.ts`, `src/lib/tz.ts`, `src/lib/db.ts` · canonical: `.prismatica/flows/follow-stops-and-record-visits.md`
- **Install, work offline and update** (`install-work-offline-and-update`) — Use the cached app and receive updates without reloading during expense entry.
  touchpoints: `src/App.svelte`, `src/components/UpdateToast.svelte`, `src/routes/Settings.svelte`, `src/lib/router.svelte.ts`, `src/lib/db.ts`, `vite.config.ts` · canonical: `.prismatica/flows/install-work-offline-and-update.md`
- **Prepare bookings and departures** (`prepare-bookings-and-departures`) — See what remains to arrange, keep reservation and payment facts, and prepare to leave.
  touchpoints: `src/components/tabs/PlanTab.svelte`, `src/components/BeforeYouGo.svelte`, `src/components/BookNeed.svelte`, `src/components/PersonalPrep.svelte`, `src/components/NextDeparture.svelte`, `src/lib/needs.ts`, `src/lib/prep.ts`, `src/lib/readiness.ts`, `src/lib/quotes.ts`, `src/lib/db.ts` · canonical: `.prismatica/flows/prepare-bookings-and-departures.md`
- **Record and review expenses** (`record-and-review-expenses`) — Keep actual spending, receipts and a truthful trip total.
  touchpoints: `src/components/ExpenseCapture.svelte`, `src/components/tabs/ExpensesTab.svelte`, `src/components/Keypad.svelte`, `src/lib/expenses.ts`, `src/lib/expense-defaults.ts`, `src/lib/money.ts`, `src/lib/fx.ts`, `src/lib/photos.ts`, `src/lib/db.ts` · canonical: `.prismatica/flows/record-and-review-expenses.md`
- **Research and revise a plan** (`research-and-revise-trip-plan`) — Bring external research into a trip and reconcile Stops while retaining personal history.
  touchpoints: `src/routes/PromptBuilder.svelte`, `src/components/tabs/PlanTab.svelte`, `src/components/PastePlanDialog.svelte`, `src/components/PlanRevision.svelte`, `src/lib/prompt.ts`, `src/lib/plan-revision.ts`, `src/lib/stops.ts`, `src/lib/headings.ts`, `src/lib/copy.svelte.ts`, `src/lib/db.ts` · canonical: `.prismatica/flows/research-and-revise-trip-plan.md`
- **Sync devices and review conflicts** (`sync-devices-and-resolve-conflicts`) — Share changes through the configured NAS and retain conflicting edits for review.
  touchpoints: `src/routes/Settings.svelte`, `src/components/ConflictList.svelte`, `src/lib/nas.svelte.ts`, `src/lib/sync.ts`, `src/lib/conflicts.ts`, `src/lib/backup-validation.ts`, `src/lib/settings.ts`, `src/lib/export.ts`, `src/lib/db.ts`, `nas/systema-backup.php` · canonical: `.prismatica/flows/sync-devices-and-resolve-conflicts.md`

## App rules

- **r-external-ai-by-handoff** — Research and journaling use copied prompts and pasted answers; Systema must not call an AI API or require a paid backend.
- **r-honest-money-and-time** — Keep estimates separate from actual payments, expose unpriced expenses and preserve explicit uncertainty in recorded event times.
- **r-local-first-records** — Keep travel records on the device and support core capture and reading offline; NAS sync is optional.
- **r-preserve-personal-history** — Plan revisions must retain personal edits, visit history, photographs and linked Moments rather than deleting them when the route changes.
- **r-restore-preserves-existing-work** — Validate backups before writes and add missing records without replacing existing records; filling blank fields requires a separate explicit choice.


## The goal

Close Stop, plan revision and photo reliability gaps

## Stay in scope — you may ONLY change

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

Never touch:

- .github/**
- AGENTS.md
- CLAUDE.md
- package.json
- package-lock.json
- tests/unit/fixtures/old-backup-validation.ts
- tests/unit/fixtures/old-sync.ts
- tests/e2e/systema-backup-v1.php
- tests/e2e/systema-backup-v1.1.php
- Preserve existing trip/Stop/City/Moment/expense IDs, visits and times, notes, pins, bookings, payment/FX links, original photo bytes/hashes and associations. Only the explicitly authorised safe retirement of obsolete generated checklist items may remove existing checklist content.
- Keep plans staged until atomic apply, reject stale reviews, retain omitted places/history and personal route additions, and preserve return-to-route placement and unchanged-plan idempotence from PRs 23–25.
- Keep IndexedDB/Dexie, offline capture and reading, optional NAS, add-only validated restore, explicit photo tombstones, merge/conflict semantics and historical backup compatibility. No destructive repair, storage clear, schema/version migration or mass rewrite.
- No accounts, runtime AI, paid services, new external data destinations, codec dependency or background conversion pipeline. Any optional metadata must validate and survive old/new readers and sync without forcing an upgrade.
- Use synthetic data and isolated browser contexts/temporary PHP receivers only. Native owner checks use a disposable origin/profile and test receiver, never the installed app database or live personal NAS. No canonical record hand edits, fabricated evidence, hook bypass, owner approvals or merge/release decisions by an agent.
- No retrospective deduplication, guessed leg reassignment, old-checklist mass pruning, automatic file transcoding or photo deletion. Unknown legacy checklist provenance always prevents automatic retirement.
- No itinerary/parser overhaul, fuzzy identity engine, new city-leg planning model, offline architecture change, thumbnail/cache subsystem, resumable background job framework, broad performance programme or unrelated UI redesign.
- Scope permission is a ceiling, not a requirement to edit every listed file. db.ts is available for minimal optional types only; sync.ts and receipt/cover/journal consumers only for direct family compatibility or failure handling. No payment, authentication, token or deployment behaviour changes. New helper and fixture paths are reserved options, not an instruction to create an abstraction or add every fixture.
- Native HEIC decoding everywhere, HEIF EXIF feature expansion and unlimited photo batch support are deferred. A memory redesign is deferred unless the fixed probe substantiates a failure; preserve and document a working bounded path instead.

## Definition of done

- **ac-1** — Manual addition after revised routes with off-route tails uses the chosen or evidenced current leg and a stable route position. Cover empty/all-retained routes, zero/one/multiple legs, Vienna–Salzburg–Vienna, gapped/tied orders and rapid additions. Existing IDs/history and an unrelated trip remain unchanged. → proven by `manual:Playwright journeys gate "manual Stops stay in the intended leg when retained records trail the itinerary" in tests/e2e/travel-reliability.spec.ts`
- **ac-2** — Distinguish no match from multiple plausible exact matches, including repeated city names and imported-name aliases. Known ambiguity needs an explicit reuse/new choice; deliberate same-name new places remain possible. Selected records retain their leg and history, each ID is used at most once, and cancellation writes nothing. → proven by `review separates ambiguous plan matches from no match and uses each record once`
- **ac-3** — Legacy extraction, candidate-presence checks, guide backfill and reviewed apply agree on safe repeated-city identity. Exercise Vienna–Salzburg–Vienna, identical names on different legs, an unassigned existing Stop, deleted/unknown legs, missing city headings, and repeated application. No arbitrary last-leg assignment, cross-leg backfill or multiplying duplicates; unknown placement stays explicit. → proven by `repeated-city plan logic never picks a leg a heading cannot name`
- **ac-4** — Three revisions retire only established unchanged obsolete unchecked generated items. Completed, manual, edited, manually recreated and uncertain legacy items survive with stable IDs/ticks; retained source items are not duplicated. Include user deletion, missing planSource, same-text personal items and reapplication. Any new provenance survives validation, ZIP and old/new sync readers. → proven by `repeated plan revisions retire only proven untouched generated checklist items`
- **ac-5** — Preserve the already-fixed unchanged-plan repeated-city behaviour, including personal and returned-to-route Stops. Extend coverage only where necessary; do not weaken existing route-retention assertions. → proven by `re-applying the same plan to a trip that returns to a city changes nothing`
- **ac-6** — Keep atomic apply and stale-editor protection: changed plan, Stop or City during review is refused without overwriting the other writer; an unstructured paste preserves the route and cancellation retains the draft. → proven by `manual:Playwright journeys gate "a stale plan review refuses concurrent edits and an unstructured paste keeps the route" in tests/e2e/plan-capture-revision.spec.ts`
- **ac-7** — Use genuine format fixtures with documented provenance and independently known byte hashes, not text blobs merely labelled as images. HEIC/HEIF, JPEG, PNG and WebP originals retain bytes, metadata links and correct format through single downloads, manifest/share output and ZIP restore. Include legacy .jpg-labelled HEIC/HEIF, absent/wrong MIME, corrupt/unrecognised input, current/old backups, add-only restore and an unrelated trip. → proven by `ZIP restore reads HEIC and HEIF originals back byte for byte under any entry name`
- **ac-8** — In a browser without the required decoder, affected photo views give honest unavailable-preview feedback and a working original download; decode failure never deletes, transforms or prevents retaining an original. A known decodable image still opens normally. Check Stop and Moment galleries and directly affected cover/journal readers. → proven by `manual:Playwright journeys gate "undecodable photo previews keep the original available to save" in tests/e2e/travel-reliability.spec.ts`
- **ac-9** — Two isolated devices converge on revised routes, repeated legs, checklist provenance/results and mixed-format photo bytes through current, previous and original real PHP receivers. Include missing photo download/restore, existing historical jpg originals, interrupted/lost upload response, repeat idle sync and explicit tombstones. Assert hashes, links and IDs, no missing-file false success or duplicate original, no extra snapshots on idle. Frozen old receivers/readers remain unchanged. → proven by `manual:Playwright with real PHP receivers (CI) "revised routes and mixed photo formats converge through current and legacy NAS receivers" in tests/e2e/php-receiver.spec.ts`
- **ac-10** — Exercise Stop batches and new/existing Moment and receipt saves, with fixed mixed sizes/capture times, missing EXIF, a failure before first save and an injected mid-batch read/hash/write/quota error. Existing originals stay intact; report partial Stop success and retain/retry pending work without duplicates. New Moment/expense plus photos roll back together and preserve the draft. Document measured batch/concurrency results and any conservative limit. → proven by `manual:Playwright journeys gate "photo batch failures preserve committed records and retry without duplicating completed work" in tests/e2e/travel-reliability.spec.ts`
- **ac-11** — Before first review, docs/travel-reliability-closure.md contains the family proof plan and one copy-ready focused proof route, backed by committed fixtures and a uniquely titled integration test. Invariants: leg identity/order, no accidental duplicate identity, safe checklist retirement, unchanged photo bytes/format/links, atomic or honestly reported partial writes, add-only restore and sync convergence. List every reader/writer: Stop add/move/return, extraction/presence/backfill, review/retention/apply and its Plan/Prompt entry paths; List/Visited/Map, TripCover, needs/readiness, Insights, JournalView and exports; Stop/Moment/receipt/cover ingestion, galleries, downloads/share/ZIP, validation, both NAS download/restore paths, upload/check/listing and old clients/receivers. Cross the equivalence classes above, prove independently specified expected IDs/order/checklist sets/hashes and a negative control that exposes the original defect; record checked-clean consumers and limits. No assertions whose expected answer comes from the function under test. → proven by `manual:Playwright journeys gate "travel reliability family proof preserves identities and originals across revision restore and sync" in tests/e2e/travel-reliability.spec.ts`
- **ac-12** — Owner reviews the six-target disposition, final exact-patch Check/independent Review and concise visual evidence at existing mobile viewports. Standard Svelte/TypeScript, lint, unit, build, journeys and secrets gates must pass, plus formatting, production PWA update, PHP syntax and isolated real-PHP suites. Provide a short disposable-origin native iPhone Safari/standalone check for camera/library HEIC, original download, offline reading and the fixed larger selection using a test receiver. Owner records hardware results or explicitly accepts the unverified native limit through the established approval gate. Agents do not mark this manual check passed or use personal data/live NAS. → proven by `manual:OWNER`

## Docs to update as part of this change

- README.md
- docs/nas-backup-setup.md
- docs/travel-reliability-closure.md

## Recommended skills (quality only — never gates)

- **ui-work** — visual / front-end work — layout, styling, interaction — _(use your agent’s equivalent)_
- **build** — implementing the change against the contract — _(use your agent’s equivalent)_
- **simplify** — reducing risk by simplifying the change — _(use your agent’s equivalent)_

## Current progress

Last checks FAILED on: traceability. Rework loops so far: 2.

## Before the first review

Family proof plan, before the first review: for subtle work — a parser, a resolver, a provider or transaction boundary, a record another reader must still parse — name each invariant, every consumer of it, its equivalence classes and how they interact, and prove them against independently derived expected results on one reproducible, focused route (committed fixtures, fixed seeds). Point to that route and its limits rather than pasting it. Routine work needs none of this. Say in your commit message where it lives.

## Before you finish

Run `prismatica flow report --auto`. It records the flows your diff provably
touched, and then prints the exact command for every flow it will not decide
for you — a merely possible hit, or a flow nothing maps to files. Answer those
yourself: `--auto` never claims a test passed and never claims behaviour is
unchanged, because no file list can establish either.

File it BEFORE `check` and commit it WITH your work — a report sitting
uncommitted proves nothing, and `check` refuses an uncommitted proof input.

## How your work will be judged

Deterministic checks run on every push and at the merge gate: the diff must stay
inside the allowed files, every acceptance check must trace to a passing test,
docs must be updated, a sealed review must match your exact diff, and the owner must sign a decision over your diff. Nothing merges until they all pass. Default is "not ready".

Current policy: acceptance evidence is the exact NAMED test, never a whole test file. After a rejection, rework is judged by the invariant FAMILY a finding named, not by matching its exact wording. A Check already bound to the reviewed head is proof — it is not to be rerun wholesale. Use the stored rejection findings from the sealed review record, verbatim, rather than re-deriving them from memory. A finding names an invariant: sweep the repository for every instance of it and list each one found plus the consumers checked clean, in one round — not one counterexample at a time.


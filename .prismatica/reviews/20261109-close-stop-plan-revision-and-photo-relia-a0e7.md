---
id: 20261109-close-stop-plan-revision-and-photo-relia-a0e7
contractId: 20261109-close-stop-plan-revision-and-photo-relia-a0e7
patchId: b643adf80cb7693d238e90ee768fd3e077b86a43
reviewer: codex
state: sealed
verdict: request_changes
findings:
  - family: Safe checklist retirement across revisions and personal edits
    summary: "P1: src/lib/plan-revision.ts:74-100 replaces planSource while leaving
      edited items marked fromPlan. Personal edits can later become eligible for
      deletion."
    counterexample: "Generate Pre-booked checked, untick it, apply a plan listing it
      unchecked, then omit it in the next revision. Expected: preserve the
      edited item and ID. Actual: it is deleted. An edited Crypt door item is
      likewise deleted after a later plan coincidentally lists that text. Extend
      repeated plan revisions retire only proven untouched generated checklist
      items."
  - family: Consistent Stop identity and ambiguity across reviewed and legacy plan
      paths
    summary: "P1: planChoices excludes assigned Stops when a multi-leg plan lacks
      city headings; matchStop separately ignores imported-name aliases. The two
      matching paths disagree."
    counterexample: "On Vienna-Salzburg-Vienna, review a headingless Museum
      candidate with one or two existing assigned Museums. Expected: reuse or
      explicit ambiguity. Actual: reviewMatches returns new-place and Apply
      creates another record. Separately, legacy presence/import treats My
      museum with planSource.name=Museum as new, while review reuses it. Extend
      repeated-city plan logic never picks a leg a heading cannot name and
      review separates ambiguous plan matches from no match and uses each record
      once."
  - family: Photo pending-work retention across additional selections and retries
    summary: "P2: StopsTab.onPhotos clears unsaved on every call while PhotoPicker
      remains enabled, silently discarding an earlier failed selection."
    counterexample: "Select A,B,C, fail after A, then successfully select D.
      Expected: A,D saved once and B,C still offered for retry. Actual: unsaved
      becomes null and B,C lose their retry action. The single queue also
      permits one Stop selection to replace another Stop's pending files. Extend
      photo batch failures preserve committed records and retry without
      duplicating completed work."
createdAt: 2026-11-09T18:30:26.204Z
sealedAt: 2026-11-09T18:47:31.523Z
---

# Review: Close Stop, plan revision and photo reliability gaps

> A fresh-eyes review, bound to one exact diff. If the code changes after this,
> the seal breaks and the review must be redone — the maths checks, not the chat.
> A Fresh Reviewer is a NEW session that did not build this diff.
> The same provider is fine — what must not be reused is the session that wrote
> the code, because it already believes the diff is right.

- **Contract:** 20261109-close-stop-plan-revision-and-photo-relia-a0e7
- **Issue:** https://github.com/ethan-ghoreishi/systema/issues/26
- **Risk tier:** heavy — auth, payments, saved data, schema/migrations — full checks, sealed review, a signed owner decision, and a tested rollback route
- **Diff patch-id:** `b643adf80cb7693d238e90ee768fd3e077b86a43`
- **Computed by:** prismatica 0.11.0 · build sha256:a53354b36e378c8f · installed package, not registry-verified

## The plan the owner approved

Verbatim. `assumptions` and `possibleConflicts` are the Planner's advisory
reading — check them against the diff rather than accepting them.

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

## The Delta this change was framed from

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



## Files in this diff

- README.md
- docs/nas-backup-setup.md
- docs/travel-reliability-closure.md
- nas/systema-backup.php
- src/components/CoverPicker.svelte
- src/components/JournalView.svelte
- src/components/PhotoGallery.svelte
- src/components/PlanRevision.svelte
- src/components/TripCover.svelte
- src/components/tabs/ExportTab.svelte
- src/components/tabs/StopsTab.svelte
- src/lib/backup-validation.ts
- src/lib/db.ts
- src/lib/export.ts
- src/lib/nas.svelte.ts
- src/lib/photo-format.ts
- src/lib/photos.ts
- src/lib/plan-revision.ts
- src/lib/stops.ts
- tests/e2e/nas-fake.ts
- tests/e2e/php-receiver.spec.ts
- tests/e2e/plan-capture-revision.spec.ts
- tests/e2e/travel-reliability.spec.ts
- tests/fixtures/reliability/sample.heic
- tests/fixtures/reliability/sample.heif
- tests/fixtures/reliability/sample.jpg
- tests/fixtures/reliability/sample.png
- tests/fixtures/reliability/sample.webp
- tests/unit/compat.test.ts
- tests/unit/photos.test.ts
- tests/unit/plan-revision.test.ts
- tests/unit/stops.test.ts

## Check against the contract

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

## Flow impact — detected vs reported

**Detected from the diff:**

- **back-up-and-restore-device** — touched via src/lib/export.ts, src/lib/backup-validation.ts, src/lib/photos.ts, src/lib/db.ts
- **capture-moments-and-photos** — touched via src/components/tabs/StopsTab.svelte, src/components/PhotoGallery.svelte, src/lib/photos.ts, src/lib/db.ts
- **compare-travel-costs** — touched via src/lib/db.ts
- **consider-destinations-and-choose-trip** — touched via src/lib/db.ts
- **create-and-edit-trip** — touched via src/lib/db.ts
- **export-trip-and-save-journal** — touched via src/components/tabs/ExportTab.svelte, src/components/JournalView.svelte, src/lib/export.ts, src/lib/db.ts
- **follow-stops-and-record-visits** — touched via src/components/tabs/StopsTab.svelte, src/components/PhotoGallery.svelte, src/lib/stops.ts, src/lib/photos.ts, src/lib/db.ts
- **install-work-offline-and-update** — touched via src/lib/db.ts
- **prepare-bookings-and-departures** — touched via src/lib/db.ts
- **record-and-review-expenses** — touched via src/lib/photos.ts, src/lib/db.ts
- **research-and-revise-trip-plan** — touched via src/components/PlanRevision.svelte, src/lib/plan-revision.ts, src/lib/stops.ts, src/lib/db.ts
- **sync-devices-and-resolve-conflicts** — touched via src/lib/nas.svelte.ts, src/lib/backup-validation.ts, src/lib/export.ts, src/lib/db.ts, nas/systema-backup.php

**Possibly affected (shares a mechanic with a detected flow):**

_none_

**What the agent reported:**

## compare-travel-costs — mechanics-updated

Mapped implementation touched: touchpoint(s) src/lib/db.ts matched changed file(s) src/lib/db.ts. Derived from the diff alone — this says nothing about whether any test ran or whether behaviour changed.

## consider-destinations-and-choose-trip — mechanics-updated

Mapped implementation touched: touchpoint(s) src/lib/db.ts matched changed file(s) src/lib/db.ts. Derived from the diff alone — this says nothing about whether any test ran or whether behaviour changed.

## create-and-edit-trip — mechanics-updated

Mapped implementation touched: touchpoint(s) src/lib/db.ts matched changed file(s) src/lib/db.ts. Derived from the diff alone — this says nothing about whether any test ran or whether behaviour changed.

## install-work-offline-and-update — mechanics-updated

Mapped implementation touched: touchpoint(s) src/lib/db.ts matched changed file(s) src/lib/db.ts. Derived from the diff alone — this says nothing about whether any test ran or whether behaviour changed.

## prepare-bookings-and-departures — mechanics-updated

Mapped implementation touched: touchpoint(s) src/lib/db.ts matched changed file(s) src/lib/db.ts. Derived from the diff alone — this says nothing about whether any test ran or whether behaviour changed.

## research-and-revise-trip-plan — truth-proposed

Review now marks known ambiguity and requires a reuse-or-new decision before apply; repeated city names leave new places unassigned; untouched plan checklist items the new plan drops are retired. Update proposed in .prismatica/flows/proposals.

Steps: 2, 3

## follow-stops-and-record-visits — truth-proposed

Leg picker and leg-aware placement when adding a place by hand; partial photo batches report what saved and retry only the rest; save-original fallback for undecodable photos. Update proposed in .prismatica/flows/proposals.

Steps: 3

## capture-moments-and-photos — mechanics-updated

Truth holds: a Moment and its photos still save together or not at all (now proven under injected failures). Mechanics: captured photos are typed by their bytes, and the gallery viewer offers Save the original when this browser cannot show a photo.

## export-trip-and-save-journal — mechanics-updated

Truth holds: export and journal still take records out unchanged. Mechanics: shared photo files are named and typed by their bytes (HEIC/HEIF no longer .jpg); the journal shows a notice and Save the original for a photo this browser cannot decode.

## back-up-and-restore-device — mechanics-updated

Truth holds: backup and add-only restore are unchanged in what they keep. Mechanics: ZIP photo entries are named for what their bytes are, restore types photos by their bytes (old .jpg-named HEIC included), and stop checklists may carry an optional fromPlan flag that validation accepts.

## sync-devices-and-resolve-conflicts — mechanics-updated

Truth holds: devices converge and conflicts are kept as before; no NAS upgrade is required. Mechanics: downloaded and restored photos are typed by their bytes, uploads keep each receiver's existing names, the current receiver keeps one file per photo id, and checklist provenance syncs through old and new merges.

## record-and-review-expenses — mechanics-updated

Truth holds: an expense and its receipt photos still save together or not at all, keeping the draft (now proven under an injected storage failure). Mechanics: receipt photos are typed by their bytes when captured.


**Gaps between detected and reported:**

_None — the report matches what was detected._

## Flow truth this change touches

### back-up-and-restore-device — Works now

Touchpoints: src/routes/Settings.svelte, src/lib/export.ts, src/lib/backup-validation.ts, src/lib/zip.ts, src/lib/photos.ts, src/lib/db.ts

Evidence: 3 steps: 3 code inferred

### capture-moments-and-photos — Works now

Touchpoints: src/components/MomentCapture.svelte, src/components/tabs/StopsTab.svelte, src/components/PhotoGallery.svelte, src/lib/moments.ts, src/lib/photos.ts, src/lib/exif.ts, src/lib/tz.ts, src/lib/db.ts

Evidence: 3 steps: 3 code inferred

### compare-travel-costs — Works now

Touchpoints: src/routes/Insights.svelte, src/routes/Home.svelte, src/lib/insights.ts, src/lib/csv.ts, src/lib/download.ts, src/lib/db.ts

Evidence: 3 steps: 3 code inferred

### consider-destinations-and-choose-trip — Works now

Touchpoints: src/routes/Home.svelte, src/routes/Opportunity.svelte, src/components/FinderImport.svelte, src/components/OptionEditor.svelte, src/lib/options.ts, src/lib/opportunities.ts, src/lib/insights.ts, src/lib/db.ts

Evidence: 3 steps: 3 code inferred

### create-and-edit-trip — Works now

Touchpoints: src/routes/NewTrip.svelte, src/routes/TripEdit.svelte, src/routes/Trip.svelte, src/components/DepartureEditor.svelte, src/lib/trips.ts, src/lib/presets.ts, src/lib/trip-shape.ts, src/lib/tz.ts, src/lib/db.ts

Evidence: 3 steps: 3 code inferred

### export-trip-and-save-journal — Works now

Touchpoints: src/components/tabs/ExportTab.svelte, src/components/tabs/PlanTab.svelte, src/components/JournalView.svelte, src/lib/export.ts, src/lib/csv.ts, src/lib/journal.ts, src/lib/markdown.ts, src/lib/download.ts, src/lib/copy.svelte.ts, src/lib/db.ts

Evidence: 3 steps: 3 code inferred

### follow-stops-and-record-visits — Works now (update proposed)

Proposed step changes:
  Traveller Open the list or map, choose a city and open a Stop.
    Shows: Planned order, notes, visit guidance, checklists and available pins appear.
    Changes: The chosen view is remembered locally.
  Traveller Open directions for a Stop with a pin.
    Shows: Google Maps opens for the destination.
    Changes: Opening directions does not mark a visit.
− Traveller Mark a visit, correct its time, or edit notes, checklist and photos.
−   Shows: Saved feedback and the Visited view show the recorded history.
−   Changes: Visit facts and edits persist independently of planned order.
+ Traveller Mark a visit, correct its time, or edit notes, checklist and photos.
+   Shows: Saved feedback and the Visited view show the recorded history; a photo batch that stops part-way says how many saved and offers to retry only the rest; a photo this browser can't show offers its original to save.
+   Changes: Visit facts and edits persist independently of planned order; photos already saved stay, and a retry never adds them twice.

Touchpoints: src/components/tabs/StopsTab.svelte, src/components/StopsMap.svelte, src/components/PhotoGallery.svelte, src/components/PhotoPicker.svelte, src/lib/stops.ts, src/lib/maps.ts, src/lib/photos.ts, src/lib/moments.ts, src/lib/tz.ts, src/lib/db.ts

Evidence: 3 steps: 3 code inferred

### install-work-offline-and-update — Works now

Touchpoints: src/App.svelte, src/components/UpdateToast.svelte, src/routes/Settings.svelte, src/lib/router.svelte.ts, src/lib/db.ts, vite.config.ts

Evidence: 3 steps: 3 code inferred

### prepare-bookings-and-departures — Works now

Touchpoints: src/components/tabs/PlanTab.svelte, src/components/BeforeYouGo.svelte, src/components/BookNeed.svelte, src/components/PersonalPrep.svelte, src/components/NextDeparture.svelte, src/lib/needs.ts, src/lib/prep.ts, src/lib/readiness.ts, src/lib/quotes.ts, src/lib/db.ts

Evidence: 3 steps: 3 code inferred

### record-and-review-expenses — Works now

Touchpoints: src/components/ExpenseCapture.svelte, src/components/tabs/ExpensesTab.svelte, src/components/Keypad.svelte, src/lib/expenses.ts, src/lib/expense-defaults.ts, src/lib/money.ts, src/lib/fx.ts, src/lib/photos.ts, src/lib/db.ts

Evidence: 3 steps: 3 code inferred

### research-and-revise-trip-plan — Works now (update proposed)

Proposed step changes:
  Traveller Choose research preferences and copy a trip or city prompt.
    Shows: A prompt is copied or offered through the copy fallback.
    Changes: Preferences are remembered; the app makes no AI request.
− Traveller Run the prompt outside Systema and paste the answer, or edit the existing plan.
−   Shows: Review Stops shows extracted places, proposed matches and retained places.
−   Changes: The plan remains a draft until review is applied.
− Traveller Review the matches and apply the plan.
−   Shows: The plan and Stops update together; a failed save retains the draft.
−   Changes: Personal edits, visits, photos, bookings and linked Moments are retained; visited places removed from the route stay off it.
+ Traveller Run the prompt outside Systema and paste the answer, or edit the existing plan.
+   Shows: Review Stops shows extracted places, proposed matches and retained places; a place two or more existing records could be is marked and offers only those records (with leg and visit) or a new place.
+   Changes: The plan remains a draft until review is applied.
+ Traveller Decide each ambiguous place, review the other matches and apply the plan.
+   Shows: Apply stays unavailable until every ambiguous place is decided; the plan and Stops update together; a failed save retains the draft.
+   Changes: Personal edits, visits, photos, bookings and linked Moments are retained; visited places removed from the route stay off it; a new place under a city the trip visits more than once stays unassigned; unticked checklist items the plan wrote and no longer lists are retired, while ticked, hand-added and older items stay.

Touchpoints: src/routes/PromptBuilder.svelte, src/components/tabs/PlanTab.svelte, src/components/PastePlanDialog.svelte, src/components/PlanRevision.svelte, src/lib/prompt.ts, src/lib/plan-revision.ts, src/lib/stops.ts, src/lib/headings.ts, src/lib/copy.svelte.ts, src/lib/db.ts

Evidence: 3 steps: 3 code inferred

### sync-devices-and-resolve-conflicts — Works now

Touchpoints: src/routes/Settings.svelte, src/components/ConflictList.svelte, src/lib/nas.svelte.ts, src/lib/sync.ts, src/lib/conflicts.ts, src/lib/backup-validation.ts, src/lib/settings.ts, src/lib/export.ts, src/lib/db.ts, nas/systema-backup.php

Evidence: 4 steps: 4 code inferred

## Also look for

- Anything outside the contract's scope or non-goals.
- Silent failures, swallowed errors, missing edge cases.
- Secrets, unsafe defaults, and anything risky for the tier.

## The builder's family proof plan

The builder was asked for one before this review: Family proof plan, before the first review: for subtle work — a parser, a resolver, a provider or transaction boundary, a record another reader must still parse — name each invariant, every consumer of it, its equivalence classes and how they interact, and prove them against independently derived expected results on one reproducible, focused route (committed fixtures, fixed seeds). Point to that route and its limits rather than pasting it. Routine work needs none of this. Find
where its commit messages say it lives; subtle work without one, or a plan
whose expected results come only from the implementation under test, is a
finding.

## Close each family in this round

A counterexample is one instance of an invariant. For every finding: name the
invariant it breaks (its family), sweep the repository for every instance of
that invariant — each consumer, sibling function and caller, not only this
diff — and list every instance you found plus the consumers you checked and
found clean. One round that names the whole family saves a round per instance.

## How to finish

Review only — change no files, run no fixes, write no records. Judge the diff
itself: the builder's summary, an earlier review and a green test run are all
claims about the code, not evidence about it.

End your reply with exactly `SAFE TO SEAL` or `DO NOT SEAL` on its own
final line, and say why. That is a recommendation to the owner, who records
the outcome — sealing is never the reviewer's to do.

If your verdict is `DO NOT SEAL`, your session is repository-read-only and cannot write the findings file itself — the owner does, from what you print. These are THREE separate copy actions, never one shell script: the JSON is DATA and must never be pasted at a normal shell prompt. Do not reconstruct or alter the path, the contract id or either command below — both commands come verbatim from Prismatica; you supply only the structured findings JSON, and it must parse as strict JSON before you present it here. End your reply with exactly these three steps, in this order, each its own fenced code block:

**1. Run this exact command** — one fenced `bash` code block containing only this command, on one logical line:

```bash
cat > '/var/folders/js/7jld3v1s7nq3fb8rnh6fl3h80000gn/T/prismatica-review-608b4096977fee1d-20261109-close-stop-plan-revision-and-photo-relia-a0e7/findings.json'
```

**2. Paste this data, then press Ctrl-D** — one fenced `json` code block containing ONE valid, compact JSON array, with each entry shaped exactly `{ "family": "...", "summary": "...", "counterexample": "..." }`. Strict JSON only: no literal newline inside a quoted string — escape multi-line finding text — and keep the array on one logical line so no viewer's word-wrap can be mistaken for a real line break.

**3. Run this exact command** — one fenced `bash` code block containing only this command, on one logical line:

```bash
prismatica seal '20261109-close-stop-plan-revision-and-photo-relia-a0e7' --request-changes --findings '/var/folders/js/7jld3v1s7nq3fb8rnh6fl3h80000gn/T/prismatica-review-608b4096977fee1d-20261109-close-stop-plan-revision-and-photo-relia-a0e7/findings.json'
```

You remain `--sandbox read-only` throughout: no `--add-dir`, no workspace-write, no heredoc, no shell interpolation, and no other findings transport. The findings file is `/var/folders/js/7jld3v1s7nq3fb8rnh6fl3h80000gn/T/prismatica-review-608b4096977fee1d-20261109-close-stop-plan-revision-and-photo-relia-a0e7/findings.json`. Never put any of your findings inside either command: they are data the owner pastes, not shell text.

Current policy: acceptance evidence is the exact NAMED test, never a whole test file. After a rejection, rework is judged by the invariant FAMILY a finding named, not by matching its exact wording. A Check already bound to the reviewed head is proof — it is not to be rerun wholesale. Use the stored rejection findings from the sealed review record, verbatim, rather than re-deriving them from memory. A finding names an invariant: sweep the repository for every instance of it and list each one found plus the consumers checked clean, in one round — not one counterexample at a time.

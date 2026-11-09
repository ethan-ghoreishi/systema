---
contractId: 20261109-close-stop-plan-revision-and-photo-relia-a0e7
at: 2026-11-09T19:00:50.135Z
by: agent
none: false
entries:
  - flowId: compare-travel-costs
    status: mechanics-updated
    reason: "Mapped implementation touched: touchpoint(s) src/lib/db.ts matched
      changed file(s) src/lib/db.ts. Derived from the diff alone — this says
      nothing about whether any test ran or whether behaviour changed."
    steps: []
    reverify: []
    truthHash: b0f39258bbcd365efea929c19ed25e271a5a64efb2603affaf69c52acfeb0845
  - flowId: consider-destinations-and-choose-trip
    status: mechanics-updated
    reason: "Mapped implementation touched: touchpoint(s) src/lib/db.ts matched
      changed file(s) src/lib/db.ts. Derived from the diff alone — this says
      nothing about whether any test ran or whether behaviour changed."
    steps: []
    reverify: []
    truthHash: ea7bd38a7d5effd3e4b6132e1feac8321d58261c11164bfd30eb0259082c4b22
  - flowId: create-and-edit-trip
    status: mechanics-updated
    reason: "Mapped implementation touched: touchpoint(s) src/lib/db.ts matched
      changed file(s) src/lib/db.ts. Derived from the diff alone — this says
      nothing about whether any test ran or whether behaviour changed."
    steps: []
    reverify: []
    truthHash: 22465f6abe86848ac54d7ba0ee5c2ad052370695c8c5c077195773dcec9a91c6
  - flowId: install-work-offline-and-update
    status: mechanics-updated
    reason: "Mapped implementation touched: touchpoint(s) src/lib/db.ts matched
      changed file(s) src/lib/db.ts. Derived from the diff alone — this says
      nothing about whether any test ran or whether behaviour changed."
    steps: []
    reverify: []
    truthHash: c19684d73f3b68b02b70ce23725039ee20afe80e7551a0649b4457513eb8c9fc
  - flowId: prepare-bookings-and-departures
    status: mechanics-updated
    reason: "Mapped implementation touched: touchpoint(s) src/lib/db.ts matched
      changed file(s) src/lib/db.ts. Derived from the diff alone — this says
      nothing about whether any test ran or whether behaviour changed."
    steps: []
    reverify: []
    truthHash: 7df4f9267da375ecdc9d2237e500ea99539a935d8d71516588144dd60426f21d
  - flowId: research-and-revise-trip-plan
    status: truth-proposed
    reason: Review now marks known ambiguity and requires a reuse-or-new decision
      before apply; repeated city names leave new places unassigned; untouched
      plan checklist items the new plan drops are retired. Update proposed in
      .prismatica/flows/proposals.
    steps:
      - 2
      - 3
    reverify: []
    truthHash: c6dafbd9cad617b758ee5e8aee4f9a120ce5b138ad492486f6f88acfb3d2890b
  - flowId: follow-stops-and-record-visits
    status: truth-proposed
    reason: Leg picker and leg-aware placement when adding a place by hand; partial
      photo batches report what saved and retry only the rest; save-original
      fallback for undecodable photos. Update proposed in
      .prismatica/flows/proposals.
    steps:
      - 3
    reverify: []
    truthHash: b7cf61b4de41048c260a6c33a9ee589dcd2517091e4249d6bfc4907b0e90a36b
  - flowId: capture-moments-and-photos
    status: mechanics-updated
    reason: "Truth holds: a Moment and its photos still save together or not at all
      (now proven under injected failures). Mechanics: captured photos are typed
      by their bytes, and the gallery viewer offers Save the original when this
      browser cannot show a photo."
    steps: []
    reverify: []
    truthHash: 69635f07804e9fc091dd76798658ce37bd460941e2227fa4fcb74faa10170a4f
  - flowId: export-trip-and-save-journal
    status: mechanics-updated
    reason: "Truth holds: export and journal still take records out unchanged.
      Mechanics: shared photo files are named and typed by their bytes
      (HEIC/HEIF no longer .jpg); the journal shows a notice and Save the
      original for a photo this browser cannot decode."
    steps: []
    reverify: []
    truthHash: 14b4f98b639a8cf30629862c2e905a02d44985c7784d539415deccb30f15774b
  - flowId: back-up-and-restore-device
    status: mechanics-updated
    reason: "Truth holds: backup and add-only restore are unchanged in what they
      keep. Mechanics: ZIP photo entries are named for what their bytes are,
      restore types photos by their bytes (old .jpg-named HEIC included), and
      stop checklists may carry an optional fromPlan flag that validation
      accepts."
    steps: []
    reverify: []
    truthHash: c36416e6a2c6579a83f3b2552ba57dc982e6273a11556660a90045c265b737fb
  - flowId: sync-devices-and-resolve-conflicts
    status: mechanics-updated
    reason: "Truth holds: devices converge and conflicts are kept as before; no NAS
      upgrade is required. Mechanics: downloaded and restored photos are typed
      by their bytes, uploads keep each receiver's existing names, the current
      receiver keeps one file per photo id, and checklist provenance syncs
      through old and new merges."
    steps: []
    reverify: []
    truthHash: 7d6e3485b4e1a0c7b717407ec232f26beb663ce1dee9a0b6faed36d6810c219e
  - flowId: record-and-review-expenses
    status: mechanics-updated
    reason: "Truth holds: an expense and its receipt photos still save together or
      not at all, keeping the draft (now proven under an injected storage
      failure). Mechanics: receipt photos are typed by their bytes when
      captured."
    steps: []
    reverify: []
    truthHash: 9f03906891d4bc27bd828b87af8f6066fa3dab33952d0e3e67d838e5771c7fa6
---

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


# Travel reliability closure

The bounded lane that closes the remaining Stop, plan-revision and
photo-original gaps (issue #26), against main `8f57daa`. Evidence is automated
Chromium and WebKit (iPhone profile) in isolated contexts with synthetic data,
plus real PHP receivers in a temporary folder. None of it is a physical iPhone
or the live NAS; that check is the owner's (below).

## Disposition of the six targets

| #   | Target                                                                  | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Manual Stop leg and order after revisions with retained off-route Stops | **Fixed.** The default leg comes from the planned route only (retained places say nothing), then the only leg, else unassigned; an optional leg picker beside the box labels repeated cities "Vienna · leg 3". `addStop` places the Stop after its leg's last route place (or before the first later leg's), inside one write, so gaps, ties and quick double adds can't collide.                                                                                          | `manual Stops stay in the intended leg when retained records trail the itinerary`                                                                                                                                                                     |
| 2   | Ambiguous plan matches shown as "New place"                             | **Fixed.** `planChoices` lists every plausible record; review marks known ambiguity, opens a choice limited to those records (leg, visited) plus "Add as a new place", and Apply stays disabled until each is decided. `savePlanRevision` refuses an undecided row. Obvious matches and ordinary new places are unchanged.                                                                                                                                                 | `ambiguous plan matches require a deliberate reuse or new-place decision`                                                                                                                                                                             |
| 3   | Legacy extraction assigns repeated cities to the last leg               | **Fixed.** `cityIds` maps a name to every leg of that name. A new Stop gets a leg only when its heading names exactly one; presence and backfill treat two equally good records as ambiguous (present, but neither filled); a named but unknown leg matches only unassigned places. Existing assignments are never changed.                                                                                                                                                | `extraction and reviewed revisions never choose an arbitrary repeated-city leg`                                                                                                                                                                       |
| 4   | Plan-generated checklist items accumulate                               | **Fixed, forward only.** Items a plan writes carry `fromPlan: true`. A revision retires an item only when it is marked, unticked, written exactly as the last plan wrote it, and absent from the new plan. Unmarked (older or hand-added) items never go. An item the last plan listed and the traveller deleted is not re-added.                                                                                                                                          | `repeated plan revisions retire only proven untouched generated checklist items`                                                                                                                                                                      |
| 5   | HEIC/HEIF misdescribed in downloads, ZIP, restore and NAS               | **Fixed.** One byte sniffer (`photo-format.ts`) decides format everywhere: capture type, single download, share files, ZIP entry names, ZIP and JSON restore, NAS download and restore. Bytes are never changed. NAS uploads keep the names every receiver uses (HEIC as `.jpg`). The current receiver keeps one file per photo id. Undecodable previews say so and offer Save the original in galleries, the viewer and the journal; the cover falls back to its drawing. | `HEIC and HEIF originals keep their bytes and format through downloads and ZIP restore`, `undecodable photo previews keep the original available to save`, `revised routes and mixed photo formats converge through current and legacy NAS receivers` |
| 6   | Larger photo batches: memory and partial failure                        | **Partial failure fixed; memory already safe.** `addPhotos` keeps each photo it saved and throws `PhotoBatchError` with the files left; Stops shows "N saved; M not saved" and retries only those. An unreadable header now means "time unknown", not a lost batch. Moment and receipt saves were already atomic and are proven so. The fixed probe found no memory problem, so the ingestion design is unchanged.                                                         | `photo batch failures preserve committed records and retry without duplicating completed work`, probe below                                                                                                                                           |

Kept as they were (proven by their existing tests):
`re-applying an unchanged plan to a trip that returns to a city changes nothing`,
`a stale plan review refuses concurrent edits and an unstructured paste keeps the route`,
and `a place put back on the route stays there when the plan is applied again`.

### How Check traces each acceptance check

Check traces only Vitest test names. The browser journeys named above still
run in the journeys gate, and ac-9's runs against real PHP receivers.

- **Traced to a Vitest test, the pure logic:**
  - ac-2: `review separates ambiguous plan matches from no match and uses each record once`
  - ac-3: `repeated-city plan logic never picks a leg a heading cannot name`
  - ac-4: `repeated plan revisions retire only proven untouched generated checklist items`
  - ac-5: `re-applying the same plan to a trip that returns to a city changes nothing`
  - ac-7: `ZIP restore reads HEIC and HEIF originals back byte for byte under any entry name`
- **Named in the contract as `manual:` checks verified by their journey:**
  ac-1, ac-6, ac-8, ac-10 and ac-11 (Playwright), and ac-9 (Playwright with
  real PHP receivers, as CI runs it). Each needs IndexedDB, the UI, a download
  or a receiver, which Node Vitest cannot reach.
- **Owner only:** ac-12.

## Family proof plan

### Invariants

1. **Leg identity and order:** a place's leg is never inferred from a repeated
   city name, from retained places or from position. A new place's position is
   unique and sits with its leg.
2. **No accidental duplicate identity:** one record is used for at most one
   plan entry. Repeated application adds nothing. One photo id has one file on
   the current receiver.
3. **Safe checklist retirement:** only proven, unticked, unchanged plan items
   go.
4. **Originals unchanged:** photo bytes, hashes and links survive every path,
   and each path names or types them by their bytes.
5. **Atomic or honestly reported writes:** a new Moment or expense saves with
   its photos or not at all. A Stop batch reports what saved and retries only
   the rest.
6. **Add-only restore and sync convergence:** restore adds what is missing.
   Devices converge, and idle syncs write nothing.

### Readers and writers

Each was either changed or checked and left as it is.

| Consumer                                                                                                                | Status                                                           |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Stop add (`addStop`, `StopsTab.addStopNow`)                                                                             | Fixed                                                            |
| Stop move (`moveStop`/`reorderStops`)                                                                                   | Checked clean: renumbers what it is given                        |
| Return to route (`returnToRoute`)                                                                                       | Shares `onRoute`; behaviour unchanged (no legs passed)           |
| Extraction, presence and backfill (`importStopsFromPlan`, `newStopCandidates`, `guideBackfill`, `matchStop`, `cityIds`) | Fixed                                                            |
| Import positions                                                                                                        | Fixed: after the highest stored order, not the row count         |
| Review (`planChoices`, `planMatches`, `reviewMatches`, `PlanRevision`)                                                  | Fixed                                                            |
| Retention and apply (`planRetained`, `savePlanRevision`)                                                                | Undecided rows refused; retention unchanged                      |
| Plan and Prompt entry paths (`PlanTab`, `PromptBuilder`, `StopsTab`)                                                    | Checked clean: all three open the same `PlanRevision`            |
| List, Visited and Map (`stopGroups`, `visitedPlaces`, `StopsMap`)                                                       | Checked clean: an unassigned place was already a supported state |
| `TripCover`                                                                                                             | Fixed: an undecodable photo falls back to the drawing            |
| Needs, readiness, Insights                                                                                              | Checked clean: they read text, done and leg, never `fromPlan`    |
| `JournalView`                                                                                                           | Fixed: an undecodable photo shows a notice and Save the original |
| Exports (trip pack, CSV, prompts)                                                                                       | Checked clean: they read `text`/`done`                           |
| Stop ingestion (`addPhotos`)                                                                                            | Fixed                                                            |
| Moment and receipt ingestion (`preparePhotos` plus a component transaction)                                             | Already atomic; proven                                           |
| Cover ingestion and picker (`CoverPicker`)                                                                              | Fixed: a failed upload says so; undecodable thumbnails say so    |
| Galleries and viewer (`PhotoGallery`)                                                                                   | Fixed                                                            |
| Single download (`downloadPhoto`)                                                                                       | Fixed                                                            |
| Share (`ExportTab.manifestFiles`)                                                                                       | Fixed                                                            |
| ZIP backup (`buildZipBackup`)                                                                                           | Fixed                                                            |
| ZIP and JSON restore (`readBackupFile`, `importBackup`)                                                                 | Fixed                                                            |
| Validation (`backup-validation`)                                                                                        | `fromPlan` is an optional boolean                                |
| NAS download (`downloadPhotos`) and NAS restore (`restorePhotos`)                                                       | Fixed: typed by bytes                                            |
| Upload (`uploadOne`)                                                                                                    | Ext by bytes, mapped to receiver names                           |
| Check and listing                                                                                                       | Checked clean: by id and size                                    |
| Old clients                                                                                                             | Validator and merge carry `fromPlan` (frozen fixtures)           |
| Old receivers (v1, v1.1)                                                                                                | Unchanged; proven against                                        |

### Equivalence classes crossed

- **Legs:** none, one, several, a repeated name (Vienna–Salzburg–Vienna), and
  an unknown or deleted name.
- **Routes:** empty, all retained, and gapped or tied orders with a retained
  tail.
- **Matches:** unique, none, ambiguous by name, ambiguous by import alias, and
  a deliberate same-name new place.
- **Checklist items:** marked, unmarked (legacy), ticked, hand-added,
  hand-recreated, edited, deleted, and no `planSource`.
- **Photo formats:** HEIC, HEIF, JPEG, PNG and WebP, plus unrecognised bytes.
- **Photo types:** correct, missing, wrong, and historical (typed JPEG).
- **Receivers:** current, previous and original.
- **Failures:** before the first write, and mid-batch on write, read, hash or
  quota.

### Fixtures

All fixtures are in `tests/fixtures/reliability/`. Each is a 32×32 test
pattern from `ffmpeg -f lavfi -i testsrc`, converted with macOS ImageIO
(`sips`) or libwebp (`cwebp`). `sips -g format` identifies each independently.
The hashes are from `shasum -a 256`.

| File          | Made with                                   | Bytes | SHA-256                                                            |
| ------------- | ------------------------------------------- | ----- | ------------------------------------------------------------------ |
| `sample.heic` | `sips -s format heic` (major brand `heic`)  | 1022  | `024afeaa6c5bf99e1bf8991d809a1506d2ebf9bf7e535fdd285b6b2e7f2d95bb` |
| `sample.heif` | `sips -s format heics` (major brand `msf1`) | 2044  | `a5d5667d41e91a4330dd6bde8cb01b9fba4d95b763030e9107d8321ec711afe7` |
| `sample.jpg`  | `sips -s format jpeg`                       | 1675  | `fc720740d2ff97389e83dadf65a3e333d295ae2f3cfa7c5823e323e1d89c4f9d` |
| `sample.png`  | `ffmpeg`                                    | 335   | `3421731e84b62704d2a6cde3d120c238c64d42ec8f770fdf88ca9e08e431c58e` |
| `sample.webp` | `cwebp`                                     | 526   | `34b7e5b7501f18f60bb2434989dcd593b754d9c82703846ec27b76ba1d4f8dbf` |

`sips` cannot write a still `mif1` HEIF. The `.heif` fixture is therefore the
genuine image-sequence form, and a unit test covers the `mif1` header.

### Proof route

Copy and run from the repository root:

```sh
npx vitest run tests/unit/photos.test.ts tests/unit/compat.test.ts tests/unit/stops.test.ts \
  tests/unit/plan-revision.test.ts
npx playwright test tests/e2e/travel-reliability.spec.ts

# Real receivers, in a temporary folder (as CI does):
mkdir -p /tmp/systema-nas && (PHP_CLI_SERVER_WORKERS=4 php -d post_max_size=8M \
  -d upload_max_filesize=8M -S 127.0.0.1:8099 -t /tmp/systema-nas &) && \
SYSTEMA_PHP_URL=http://127.0.0.1:8099 SYSTEMA_PHP_ROOT=/tmp/systema-nas \
  npx playwright test tests/e2e/php-receiver.spec.ts -g "mixed photo formats"
```

The integration test
`travel reliability family proof preserves identities and originals across revision restore and sync`
crosses extraction, a reviewed revision, a manual addition, mixed formats,
two-device sync and ZIP restore. It checks hand-written expectations: IDs,
order, legs, checklist sets and fixture hashes. It ends with a **negative
control**: the previous `cityIds`, `photoExt`, checklist and default-leg rules,
written inline, fail those same expectations.

### Photo batch probe

The fixed baseline was 24 photos of 5 MiB and one of 20 MiB (140 MiB in all),
through `addPhotos`. It is opt-in, with
`SYSTEMA_PHOTO_PROBE=1 npx playwright test -g "photo batch probe"`. It ran on
desktop Chromium, the Pixel 7 profile, and WebKit with the iPhone 14 profile:

| Project                | Saved | In order | Time   | Peak header reads | Longest main-thread pause |
| ---------------------- | ----- | -------- | ------ | ----------------- | ------------------------- |
| chromium               | 25/25 | yes      | 141 ms | 25 (256 KiB each) | 19 ms                     |
| mobile-chromium        | 25/25 | yes      | 140 ms | 25                | 16 ms                     |
| mobile-safari (WebKit) | 25/25 | yes      | 190 ms | 25                | 14 ms                     |

The probe's files were generated in memory, so it shows ordering, concurrency
and responsiveness, not iPhone memory. Photos are written one at a time; at
most one photo's bytes are copied at once; and header reads are capped at
256 KiB each (about 6 MiB for this batch). Nothing measured justified a
mitigation. The batch size is evidence, not a limit, and no device memory
ceiling is inferred.

## Limits

These are accepted, not fixed.

- **Preview depends on the browser.** Chromium cannot decode HEIC or HEIF;
  WebKit on Apple platforms can. Where it can't, the original is kept and can
  be saved. Nothing is converted.
- **NAS filenames.** HEIC and HEIF are stored as `.jpg` on every receiver, as
  before. Systema reads the bytes. Copying files off the NAS by hand needs an
  app that opens files by content.
- **Old clients.**
  - An older app version types a downloaded HEIC as JPEG, and gives a new
    ZIP's `.heic` entries no type. The bytes are intact.
  - An older receiver may hold a second, identical file for one photo id in
    the rare case of a PNG or WebP an older app named `.jpg`.
- **Older checklist items.** Plan items written before this version carry no
  mark, so they are never retired automatically; delete them by hand.
- **Repeated ambiguity.** A plan that lists the same place on two visits to a
  city asks which record is which each time it is applied. That is the price
  of never guessing.

## Owner check (not automated)

Use a disposable origin or profile and a test receiver, never the installed
app database or the live NAS. On an iPhone, in Safari and as the installed app:

1. Take a HEIC photo with the camera, and choose one from the library.
2. Save the original and confirm the file type.
3. Go offline, and reopen the trip and the photos.
4. Pick about 25 library photos at once.
5. Sync with the test receiver.

Record the result, or accept the unverified native limit, through the approval
gate.

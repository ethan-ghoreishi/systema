---
id: 20261109-close-stop-plan-revision-and-photo-relia-a0e7
contractId: 20261109-close-stop-plan-revision-and-photo-relia-a0e7
patchId: 6d78a380803438c159f0f9599fa1b0e7d3aea9fb
reviewer: codex
state: sealed
verdict: approve
createdAt: 2026-11-09T19:10:27.908Z
sealedAt: 2026-11-09T19:16:01.606Z
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
- **Diff patch-id:** `6d78a380803438c159f0f9599fa1b0e7d3aea9fb`
- **Computed by:** prismatica 0.11.0 · build sha256:a53354b36e378c8f · installed package, not registry-verified

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



## Re-review after a rejection — scoped to the rework

The last review of this contract asked for changes. This is NOT the whole plan
restated: it is what changed since the previously reviewed head, the findings
that review recorded, and the paths the rework touched — read any file you need
from the lane. The same Check already bound to this head is not to be rerun
wholesale.

Verify each prior finding's FAMILY across every consumer in the repository, not
only the lines this rework changed: a family is closed when no instance of its
invariant survives anywhere, and a fix that reached one consumer while a sibling
still breaks it is not closed.

**Approved intent:** `.prismatica/intents/20261109-close-stop-plan-revision-and-photo-relia-a0e7.md`

**Findings from the previous review:**

- **Safe checklist retirement across revisions and personal edits** — P1: src/lib/plan-revision.ts:74-100 replaces planSource while leaving edited items marked fromPlan. Personal edits can later become eligible for deletion.
  _counterexample:_ Generate Pre-booked checked, untick it, apply a plan listing it unchecked, then omit it in the next revision. Expected: preserve the edited item and ID. Actual: it is deleted. An edited Crypt door item is likewise deleted after a later plan coincidentally lists that text. Extend repeated plan revisions retire only proven untouched generated checklist items.
- **Consistent Stop identity and ambiguity across reviewed and legacy plan paths** — P1: planChoices excludes assigned Stops when a multi-leg plan lacks city headings; matchStop separately ignores imported-name aliases. The two matching paths disagree.
  _counterexample:_ On Vienna-Salzburg-Vienna, review a headingless Museum candidate with one or two existing assigned Museums. Expected: reuse or explicit ambiguity. Actual: reviewMatches returns new-place and Apply creates another record. Separately, legacy presence/import treats My museum with planSource.name=Museum as new, while review reuses it. Extend repeated-city plan logic never picks a leg a heading cannot name and review separates ambiguous plan matches from no match and uses each record once.
- **Photo pending-work retention across additional selections and retries** — P2: StopsTab.onPhotos clears unsaved on every call while PhotoPicker remains enabled, silently discarding an earlier failed selection.
  _counterexample:_ Select A,B,C, fail after A, then successfully select D. Expected: A,D saved once and B,C still offered for retry. Actual: unsaved becomes null and B,C lose their retry action. The single queue also permits one Stop selection to replace another Stop's pending files. Extend photo batch failures preserve committed records and retry without duplicating completed work.

**What changed since the previously reviewed head:**

```diff
diff --git a/docs/travel-reliability-closure.md b/docs/travel-reliability-closure.md
index a53c5832fd99ee7e514eeed31a2fab569d1af296..d2becc8612ed3742b1a7a9bca0df117a25520664 100644
--- a/docs/travel-reliability-closure.md
+++ b/docs/travel-reliability-closure.md
@@ -8,14 +8,14 @@ or the live NAS; that check is the owner's (below).
 
 ## Disposition of the six targets
 
-| #   | Target                                                                  | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                                                                              |
-| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
-| 1   | Manual Stop leg and order after revisions with retained off-route Stops | **Fixed.** The default leg comes from the planned route only (retained places say nothing), then the only leg, else unassigned; an optional leg picker beside the box labels repeated cities "Vienna · leg 3". `addStop` places the Stop after its leg's last route place (or before the first later leg's), inside one write, so gaps, ties and quick double adds can't collide.                                                                                          | `manual Stops stay in the intended leg when retained records trail the itinerary`                                                                                                                                                                     |
-| 2   | Ambiguous plan matches shown as "New place"                             | **Fixed.** `planChoices` lists every plausible record; review marks known ambiguity, opens a choice limited to those records (leg, visited) plus "Add as a new place", and Apply stays disabled until each is decided. `savePlanRevision` refuses an undecided row. Obvious matches and ordinary new places are unchanged.                                                                                                                                                 | `ambiguous plan matches require a deliberate reuse or new-place decision`                                                                                                                                                                             |
-| 3   | Legacy extraction assigns repeated cities to the last leg               | **Fixed.** `cityIds` maps a name to every leg of that name. A new Stop gets a leg only when its heading names exactly one; presence and backfill treat two equally good records as ambiguous (present, but neither filled); a named but unknown leg matches only unassigned places. Existing assignments are never changed.                                                                                                                                                | `extraction and reviewed revisions never choose an arbitrary repeated-city leg`                                                                                                                                                                       |
-| 4   | Plan-generated checklist items accumulate                               | **Fixed, forward only.** Items a plan writes carry `fromPlan: true`. A revision retires an item only when it is marked, unticked, written exactly as the last plan wrote it, and absent from the new plan. Unmarked (older or hand-added) items never go. An item the last plan listed and the traveller deleted is not re-added.                                                                                                                                          | `repeated plan revisions retire only proven untouched generated checklist items`                                                                                                                                                                      |
-| 5   | HEIC/HEIF misdescribed in downloads, ZIP, restore and NAS               | **Fixed.** One byte sniffer (`photo-format.ts`) decides format everywhere: capture type, single download, share files, ZIP entry names, ZIP and JSON restore, NAS download and restore. Bytes are never changed. NAS uploads keep the names every receiver uses (HEIC as `.jpg`). The current receiver keeps one file per photo id. Undecodable previews say so and offer Save the original in galleries, the viewer and the journal; the cover falls back to its drawing. | `HEIC and HEIF originals keep their bytes and format through downloads and ZIP restore`, `undecodable photo previews keep the original available to save`, `revised routes and mixed photo formats converge through current and legacy NAS receivers` |
-| 6   | Larger photo batches: memory and partial failure                        | **Partial failure fixed; memory already safe.** `addPhotos` keeps each photo it saved and throws `PhotoBatchError` with the files left; Stops shows "N saved; M not saved" and retries only those. An unreadable header now means "time unknown", not a lost batch. Moment and receipt saves were already atomic and are proven so. The fixed probe found no memory problem, so the ingestion design is unchanged.                                                         | `photo batch failures preserve committed records and retry without duplicating completed work`, probe below                                                                                                                                           |
+| #   | Target                                                                  | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Evidence                                                                                                                                                                                                                                              |
+| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
+| 1   | Manual Stop leg and order after revisions with retained off-route Stops | **Fixed.** The default leg comes from the planned route only (retained places say nothing), then the only leg, else unassigned; an optional leg picker beside the box labels repeated cities "Vienna · leg 3". `addStop` places the Stop after its leg's last route place (or before the first later leg's), inside one write, so gaps, ties and quick double adds can't collide.                                                                                                                                                                                                                                   | `manual Stops stay in the intended leg when retained records trail the itinerary`                                                                                                                                                                     |
+| 2   | Ambiguous plan matches shown as "New place"                             | **Fixed.** One rule, `stopChoices`, decides which records a plan entry could be, for review and for legacy import, presence and backfill alike: same name or import name; on a named city's legs first, then on no leg; with no city heading, any leg. `planChoices` lists those records; review marks known ambiguity, opens a choice limited to those records (leg, visited) plus "Add as a new place", and Apply stays disabled until each is decided. `savePlanRevision` refuses an undecided row. Obvious matches and ordinary new places are unchanged.                                                       | `ambiguous plan matches require a deliberate reuse or new-place decision`                                                                                                                                                                             |
+| 3   | Legacy extraction assigns repeated cities to the last leg               | **Fixed.** `cityIds` maps a name to every leg of that name. A new Stop gets a leg only when its heading names exactly one; presence and backfill treat two equally good records as ambiguous (present, but neither filled); a named but unknown leg matches only unassigned places. Existing assignments are never changed.                                                                                                                                                                                                                                                                                         | `extraction and reviewed revisions never choose an arbitrary repeated-city leg`                                                                                                                                                                       |
+| 4   | Plan-generated checklist items accumulate                               | **Fixed, forward only.** Items a plan writes carry `fromPlan: true`. Ticking or unticking by hand removes the mark, and so does a revision that lists an item no longer reading exactly as the plan wrote it, so a later plan that happens to list it can never make it retirable. A revision retires an item only when it is marked, unticked, written exactly as the last plan wrote it, and absent from the new plan. Unmarked (older or hand-added) items never go. An item the last plan listed and the traveller deleted is not re-added.                                                                     | `repeated plan revisions retire only proven untouched generated checklist items`                                                                                                                                                                      |
+| 5   | HEIC/HEIF misdescribed in downloads, ZIP, restore and NAS               | **Fixed.** One byte sniffer (`photo-format.ts`) decides format everywhere: capture type, single download, share files, ZIP entry names, ZIP and JSON restore, NAS download and restore. Bytes are never changed. NAS uploads keep the names every receiver uses (HEIC as `.jpg`). The current receiver keeps one file per photo id. Undecodable previews say so and offer Save the original in galleries, the viewer and the journal; the cover falls back to its drawing.                                                                                                                                          | `HEIC and HEIF originals keep their bytes and format through downloads and ZIP restore`, `undecodable photo previews keep the original available to save`, `revised routes and mixed photo formats converge through current and legacy NAS receivers` |
+| 6   | Larger photo batches: memory and partial failure                        | **Partial failure fixed; memory already safe.** `addPhotos` keeps each photo it saved and throws `PhotoBatchError` with the files left; Stops shows "N saved; M not saved" and retries only those. Waiting photos are kept per Stop: a later selection, on that Stop or another, adds to them rather than replacing them, and a retry takes them out at once so a second tap can't save them twice. An unreadable header now means "time unknown", not a lost batch. Moment and receipt saves were already atomic and are proven so. The fixed probe found no memory problem, so the ingestion design is unchanged. | `photo batch failures preserve committed records and retry without duplicating completed work`, probe below                                                                                                                                           |
 
 Kept as they were (proven by their existing tests):
 `re-applying an unchanged plan to a trip that returns to a city changes nothing`,
@@ -50,12 +50,12 @@ run in the journeys gate, and ac-9's runs against real PHP receivers.
    plan entry. Repeated application adds nothing. One photo id has one file on
    the current receiver.
 3. **Safe checklist retirement:** only proven, unticked, unchanged plan items
-   go.
+   go. The mark is proof only while the item reads exactly as a plan wrote it.
 4. **Originals unchanged:** photo bytes, hashes and links survive every path,
    and each path names or types them by their bytes.
 5. **Atomic or honestly reported writes:** a new Moment or expense saves with
    its photos or not at all. A Stop batch reports what saved and retries only
-   the rest.
+   the rest; no later selection drops work still waiting.
 6. **Add-only restore and sync convergence:** restore adds what is missing.
    Devices converge, and idle syncs write nothing.
 
@@ -63,35 +63,38 @@ run in the journeys gate, and ac-9's runs against real PHP receivers.
 
 Each was either changed or checked and left as it is.
 
-| Consumer                                                                                                                | Status                                                           |
-| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
-| Stop add (`addStop`, `StopsTab.addStopNow`)                                                                             | Fixed                                                            |
-| Stop move (`moveStop`/`reorderStops`)                                                                                   | Checked clean: renumbers what it is given                        |
-| Return to route (`returnToRoute`)                                                                                       | Shares `onRoute`; behaviour unchanged (no legs passed)           |
-| Extraction, presence and backfill (`importStopsFromPlan`, `newStopCandidates`, `guideBackfill`, `matchStop`, `cityIds`) | Fixed                                                            |
-| Import positions                                                                                                        | Fixed: after the highest stored order, not the row count         |
-| Review (`planChoices`, `planMatches`, `reviewMatches`, `PlanRevision`)                                                  | Fixed                                                            |
-| Retention and apply (`planRetained`, `savePlanRevision`)                                                                | Undecided rows refused; retention unchanged                      |
-| Plan and Prompt entry paths (`PlanTab`, `PromptBuilder`, `StopsTab`)                                                    | Checked clean: all three open the same `PlanRevision`            |
-| List, Visited and Map (`stopGroups`, `visitedPlaces`, `StopsMap`)                                                       | Checked clean: an unassigned place was already a supported state |
-| `TripCover`                                                                                                             | Fixed: an undecodable photo falls back to the drawing            |
-| Needs, readiness, Insights                                                                                              | Checked clean: they read text, done and leg, never `fromPlan`    |
-| `JournalView`                                                                                                           | Fixed: an undecodable photo shows a notice and Save the original |
-| Exports (trip pack, CSV, prompts)                                                                                       | Checked clean: they read `text`/`done`                           |
-| Stop ingestion (`addPhotos`)                                                                                            | Fixed                                                            |
-| Moment and receipt ingestion (`preparePhotos` plus a component transaction)                                             | Already atomic; proven                                           |
-| Cover ingestion and picker (`CoverPicker`)                                                                              | Fixed: a failed upload says so; undecodable thumbnails say so    |
-| Galleries and viewer (`PhotoGallery`)                                                                                   | Fixed                                                            |
-| Single download (`downloadPhoto`)                                                                                       | Fixed                                                            |
-| Share (`ExportTab.manifestFiles`)                                                                                       | Fixed                                                            |
-| ZIP backup (`buildZipBackup`)                                                                                           | Fixed                                                            |
-| ZIP and JSON restore (`readBackupFile`, `importBackup`)                                                                 | Fixed                                                            |
-| Validation (`backup-validation`)                                                                                        | `fromPlan` is an optional boolean                                |
-| NAS download (`downloadPhotos`) and NAS restore (`restorePhotos`)                                                       | Fixed: typed by bytes                                            |
-| Upload (`uploadOne`)                                                                                                    | Ext by bytes, mapped to receiver names                           |
-| Check and listing                                                                                                       | Checked clean: by id and size                                    |
-| Old clients                                                                                                             | Validator and merge carry `fromPlan` (frozen fixtures)           |
-| Old receivers (v1, v1.1)                                                                                                | Unchanged; proven against                                        |
+| Consumer                                                                                                                | Status                                                                                                                                                 |
+| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
+| Stop add (`addStop`, `StopsTab.addStopNow`)                                                                             | Fixed                                                                                                                                                  |
+| Stop move (`moveStop`/`reorderStops`)                                                                                   | Checked clean: renumbers what it is given                                                                                                              |
+| Return to route (`returnToRoute`)                                                                                       | Shares `onRoute`; behaviour unchanged (no legs passed)                                                                                                 |
+| Extraction, presence and backfill (`importStopsFromPlan`, `newStopCandidates`, `guideBackfill`, `matchStop`, `cityIds`) | Fixed: through `stopChoices`, shared with review                                                                                                       |
+| Import positions                                                                                                        | Fixed: after the highest stored order, not the row count                                                                                               |
+| Review (`planChoices`, `planMatches`, `reviewMatches`, `PlanRevision`)                                                  | Fixed: through `stopChoices`                                                                                                                           |
+| Checklist writers (`revisedStop`, `planItem`, `toggleChecklistItem`)                                                    | Fixed: a changed or hand-ticked item loses its mark                                                                                                    |
+| Checklist writers (`addChecklistItem`, `deleteChecklistItem`)                                                           | Checked clean: added items are unmarked; deletion removes                                                                                              |
+| Stop waiting photos (`StopsTab.onPhotos`)                                                                               | Fixed: kept per Stop, added to, retried once                                                                                                           |
+| Retention and apply (`planRetained`, `savePlanRevision`)                                                                | Undecided rows refused; retention unchanged                                                                                                            |
+| Plan and Prompt entry paths (`PlanTab`, `PromptBuilder`, `StopsTab`)                                                    | Checked clean: all three open the same `PlanRevision`                                                                                                  |
+| List, Visited and Map (`stopGroups`, `visitedPlaces`, `StopsMap`)                                                       | Checked clean: an unassigned place was already a supported state                                                                                       |
+| `TripCover`                                                                                                             | Fixed: an undecodable photo falls back to the drawing                                                                                                  |
+| Needs, readiness, Insights                                                                                              | Checked clean: they read text, done and leg, never `fromPlan`                                                                                          |
+| `JournalView`                                                                                                           | Fixed: an undecodable photo shows a notice and Save the original                                                                                       |
+| Exports (trip pack, CSV, prompts)                                                                                       | Checked clean: they read `text`/`done`                                                                                                                 |
+| Stop ingestion (`addPhotos`)                                                                                            | Fixed                                                                                                                                                  |
+| Moment and receipt ingestion (`preparePhotos` plus a component transaction)                                             | Already atomic; proven. Checked clean for waiting work: their pickers add to the draft's files, are disabled while saving, and clear only after a save |
+| Cover ingestion and picker (`CoverPicker`)                                                                              | Fixed: a failed upload says so; undecodable thumbnails say so                                                                                          |
+| Galleries and viewer (`PhotoGallery`)                                                                                   | Fixed                                                                                                                                                  |
+| Single download (`downloadPhoto`)                                                                                       | Fixed                                                                                                                                                  |
+| Share (`ExportTab.manifestFiles`)                                                                                       | Fixed                                                                                                                                                  |
+| ZIP backup (`buildZipBackup`)                                                                                           | Fixed                                                                                                                                                  |
+| ZIP and JSON restore (`readBackupFile`, `importBackup`)                                                                 | Fixed                                                                                                                                                  |
+| Validation (`backup-validation`)                                                                                        | `fromPlan` is an optional boolean                                                                                                                      |
+| NAS download (`downloadPhotos`) and NAS restore (`restorePhotos`)                                                       | Fixed: typed by bytes                                                                                                                                  |
+| Upload (`uploadOne`)                                                                                                    | Ext by bytes, mapped to receiver names                                                                                                                 |
+| Check and listing                                                                                                       | Checked clean: by id and size                                                                                                                          |
+| Old clients                                                                                                             | Validator and merge carry `fromPlan` (frozen fixtures)                                                                                                 |
+| Old receivers (v1, v1.1)                                                                                                | Unchanged; proven against                                                                                                                              |
 
 ### Equivalence classes crossed
 
@@ -188,6 +191,9 @@ These are accepted, not fixed.
     the rare case of a PNG or WebP an older app named `.jpg`.
 - **Older checklist items.** Plan items written before this version carry no
   mark, so they are never retired automatically; delete them by hand.
+- **Ticks on an older app.** An older version ticks without removing the
+  mark. An item it unticks back to how the plan wrote it reads as untouched
+  and can be retired; any other change keeps it.
 - **Repeated ambiguity.** A plan that lists the same place on two visits to a
   city asks which record is which each time it is applied. That is the price
   of never guessing.
diff --git a/src/components/tabs/StopsTab.svelte b/src/components/tabs/StopsTab.svelte
index 57cb38a116a4fa1c52b87637f2a88d5324e24b1f..aca07336d2b018a77d9b1338048fb37129de3eaf 100644
--- a/src/components/tabs/StopsTab.svelte
+++ b/src/components/tabs/StopsTab.svelte
@@ -391,24 +391,27 @@
   }
 
   // ---- detail: photos + checklist ----
-  // Photos of a batch that stopped part-way, kept to retry for that stop only.
-  let unsaved = $state<{ stopId: string; files: Blob[]; saved: number; reason: string } | null>(
-    null,
-  );
-  async function onPhotos(files: Blob[]) {
+  // Photos of batches that stopped part-way, kept per stop until retried.
+  // Another selection, on this stop or another, adds to them, never replaces them.
+  let unsaved = $state<Record<string, { files: Blob[]; saved: number; reason: string }>>({});
+  async function onPhotos(files: Blob[], retry = false) {
     if (!selected) return;
     const stopId = selected.id;
     const tz = zoneOf(selected, cities);
-    unsaved = null;
+    // A retry takes the pending files out at once, so a second tap can't save them twice.
+    if (retry) delete unsaved[stopId];
     try {
       await addPhotos(files, { tripId: trip.id, stopId, kind: 'stop', tz });
       flashSaved();
     } catch (err) {
       // What saved stays saved; only the rest is offered again, so nothing is added twice.
-      unsaved =
-        err instanceof PhotoBatchError
-          ? { stopId, files: err.remaining, saved: err.saved.length, reason: err.message }
-          : { stopId, files, saved: 0, reason: err instanceof Error ? err.message : String(err) };
+      const batch = err instanceof PhotoBatchError;
+      const pending = unsaved[stopId];
+      unsaved[stopId] = {
+        files: [...(pending?.files ?? []), ...(batch ? err.remaining : files)],
+        saved: (pending?.saved ?? 0) + (batch ? err.saved.length : 0),
+        reason: err instanceof Error ? err.message : String(err),
+      };
     }
   }
 
@@ -697,13 +700,14 @@
       {#if photos.length}
         <PhotoGallery {photos} label={selected.name} />
       {/if}
-      {#if unsaved?.stopId === selected.id}
-        {@const left = unsaved.files}
+      {#if unsaved[selected.id]}
+        {@const pending = unsaved[selected.id]}
+        {@const left = pending.files}
         <p role="alert" class="hint hint--warn">
-          {unsaved.saved} photo{unsaved.saved === 1 ? '' : 's'} saved; {left.length} not saved: {unsaved.reason}.
+          {pending.saved} photo{pending.saved === 1 ? '' : 's'} saved; {left.length} not saved: {pending.reason}.
           Free some space if storage is full, then retry. The photos already saved stay as they are.
         </p>
-        <button class="btn btn--ghost" onclick={() => onPhotos(left)}
+        <button class="btn btn--ghost" onclick={() => onPhotos(left, true)}
           >Retry {left.length} photo{left.length === 1 ? '' : 's'}</button
         >
       {/if}
diff --git a/src/lib/plan-revision.ts b/src/lib/plan-revision.ts
index d1a2b2078b0a3b7c63b26b436f64e9205de53c11..d818c90a5688fc594061e785140c6ac3ee8d983c 100644
--- a/src/lib/plan-revision.ts
+++ b/src/lib/plan-revision.ts
@@ -1,31 +1,23 @@
-import { db, type City, type Stop, type Trip } from './db';
-import { extractStopsFromPlan, planItem, type StopCandidate } from './stops';
+import { db, type ChecklistItem, type City, type Stop, type Trip } from './db';
+import { cityIds, extractStopsFromPlan, planItem, stopChoices, type StopCandidate } from './stops';
 import { same } from './sync';
 import { newId } from './ids';
 import { updateTrip } from './trips';
 
 const key = (name: string) => name.trim().toLocaleLowerCase();
 
-/** The legs this plan text could be speaking about: every leg of that name. */
-function planCities(candidate: StopCandidate, cities: City[]): City[] {
-  const named = cities.filter((city) => key(city.name) === key(candidate.city ?? ''));
-  return named.length ? named : !candidate.city && cities.length === 1 ? cities : [];
-}
-
 /** Unlabelled single-city plans are safe to assign; repeated city names need an explicit leg. */
 export function planCityId(candidate: StopCandidate, cities: City[]): string | null {
-  const named = planCities(candidate, cities);
-  return named.length === 1 ? named[0].id : null;
+  const named = cities.filter((city) => key(city.name) === key(candidate.city ?? ''));
+  const legs = named.length ? named : !candidate.city && cities.length === 1 ? cities : [];
+  return legs.length === 1 ? legs[0].id : null;
 }
 
 /**
- * The existing places each candidate could be: same name (or the name it was
- * imported under), on one of the candidate's legs or on none. A city the trip
- * returns to cannot say which leg a new place belongs on, but an existing
- * place of that name on one of those legs is still that place — and keeps its
- * own leg. A place with no leg of its own can be any leg's: otherwise
- * re-applying the plan that created it would add it a second time. A place
- * that is the only choice for an earlier candidate is no one else's.
+ * The existing places each candidate could be, by the same rule legacy import
+ * uses (stopChoices). An existing place keeps its own leg, even in a city the
+ * trip returns to. A place that is the only choice for an earlier candidate is
+ * no one else's.
  */
 export function planChoices(
   candidates: StopCandidate[],
@@ -33,16 +25,11 @@ export function planChoices(
   cities: City[],
 ): string[][] {
   const used = new Set<string>();
+  const legs = cityIds(cities);
   return candidates.map((c) => {
-    const legs = new Set(planCities(c, cities).map((city) => city.id));
-    const named = stops.filter(
-      (s) =>
-        !used.has(s.id) &&
-        [s.name, s.planSource?.name].some((name) => name && key(name) === key(c.name)) &&
-        (!s.cityId || legs.has(s.cityId)),
-    );
-    if (named.length === 1) used.add(named[0].id);
-    return named.map((s) => s.id);
+    const ids = stopChoices(c, stops, legs, used).map((s) => s.id);
+    if (ids.length === 1) used.add(ids[0]);
+    return ids;
   });
 }
 
@@ -88,17 +75,28 @@ export function revisedStop(stop: Stop, next: StopCandidate, previous?: StopCand
     row.lat = next.lat;
     row.lng = next.lng;
   }
-  // Retire only the plan's own unticked items that the plan wrote exactly so
-  // and no longer lists. Ticked items, items added by hand, and items whose
-  // origin is unknown (written before items were marked) always stay.
-  // An item the plan wrote ticked and is now unticked has been edited: it stays.
+  // Retire only the plan's own unticked items, still exactly as the plan in
+  // force wrote them, that the new plan no longer lists. Ticked items, items
+  // added by hand, and items whose origin is unknown (written before items
+  // were marked) always stay. An item that no longer reads as written — its
+  // tick or text changed — is the traveller's: once the new plan lists it, it
+  // loses its mark, so a coincidental listing can never make it retirable.
   const listed = stop.planSource?.checklist ?? [];
-  const untouched = new Set(listed.filter((item) => !item.done).map((item) => item.text));
+  const asWritten = (item: ChecklistItem, plan: { text: string; done: boolean }[]) =>
+    plan.some((p) => p.text === item.text && p.done === item.done);
   const nextKeys = new Set(next.checklist.map((item) => key(item.text)));
-  row.checklist = stop.checklist.filter(
-    (item) =>
-      !(item.fromPlan && !item.done && untouched.has(item.text) && !nextKeys.has(key(item.text))),
-  );
+  row.checklist = [];
+  for (const item of stop.checklist) {
+    if (!item.fromPlan) row.checklist.push(item);
+    else if (!nextKeys.has(key(item.text))) {
+      if (item.done || !asWritten(item, listed)) row.checklist.push(item);
+    } else if (asWritten(item, listed) && asWritten(item, next.checklist)) row.checklist.push(item);
+    else {
+      const own = { ...item };
+      delete own.fromPlan;
+      row.checklist.push(own);
+    }
+  }
   // Add new discoveries once. One the last plan already listed and that is
   // gone from the stop was deleted by hand: it stays deleted.
   const listedKeys = new Set(listed.map((item) => key(item.text)));
diff --git a/src/lib/stops.ts b/src/lib/stops.ts
index a5094eae5b7cedaa703e7d46fdd4dde26bdd3b8e..f891a5f592310516015306cf08c4552ee6031ab4 100644
--- a/src/lib/stops.ts
+++ b/src/lib/stops.ts
@@ -215,7 +215,10 @@ export async function addChecklistItem(stop: Stop, text: string): Promise<void>
 export async function toggleChecklistItem(stop: Stop, itemId: string): Promise<void> {
   await db.stops.update(stop.id, (s) => {
     const item = s.checklist.find((c) => c.id === itemId);
-    if (item) item.done = !item.done;
+    if (!item) return;
+    item.done = !item.done;
+    // Touched by the traveller: no later revision may retire it.
+    delete item.fromPlan;
   });
 }
 
@@ -521,33 +524,39 @@ export function extractStopsFromPlan(
 const key = (name: string) => name.trim().toLowerCase();
 
 /**
- * The stop already in the list that a plan candidate is, if any. Same name,
- * and — where the plan says which city — on one of that city's legs: two
- * cities can each have a Duomo, and neither should swallow the other. A stop
- * that doesn't say which leg it is on (added before the trip had legs, or on
- * a single-city trip) can stand for a candidate from any city, but only for
- * one of them: `taken` carries the stops already spoken for. Two equally good
- * stops — a city the trip returns to, with that place on two of its legs —
- * are 'ambiguous': the place is there, but which record it is can't be said.
+ * The existing stops a plan candidate could be: none (a new place), one, or
+ * several (ambiguous — which record it is can't be said). The one rule both
+ * reviewed revision and legacy import/presence/backfill use. Same name, or the
+ * name it was imported under. Where the plan says which city, a stop on one of
+ * that city's legs first — two cities can each have a Duomo — and only then a
+ * stop with no leg (added before the trip had legs); a city the trip no longer
+ * has matches only those. With no city heading, any leg's stop of that name
+ * may be it. `taken` carries the stops already spoken for.
  */
+export function stopChoices(
+  c: StopCandidate,
+  existing: Stop[],
+  legsByName: Map<string, string[]>,
+  taken: Set<string>,
+): Stop[] {
+  const legs = c.city ? (legsByName.get(key(c.city)) ?? []) : undefined;
+  const named = existing.filter(
+    (s) =>
+      !taken.has(s.id) && [s.name, s.planSource?.name].some((n) => n && key(n) === key(c.name)),
+  );
+  if (!legs) return named;
+  const own = named.filter((s) => !!s.cityId && legs.includes(s.cityId));
+  return own.length ? own : named.filter((s) => !s.cityId);
+}
+
 function matchStop(
   c: StopCandidate,
   existing: Stop[],
   legsByName: Map<string, string[]>,
   taken: Set<string>,
 ): Stop | 'ambiguous' | undefined {
-  // A named city with no leg of that name (deleted, or not a city) matches only places with no leg.
-  const legs = c.city ? (legsByName.get(key(c.city)) ?? []) : undefined;
-  const named = existing.filter((s) => !taken.has(s.id) && key(s.name) === key(c.name));
-  // The stop on the candidate's own leg first; only then one with no leg.
-  for (const tier of [
-    named.filter((s) => !!legs && !!s.cityId && legs.includes(s.cityId)),
-    named.filter((s) => !legs || !s.cityId),
-  ]) {
-    if (tier.length === 1) return tier[0];
-    if (tier.length > 1) return 'ambiguous';
-  }
-  return undefined;
+  const choices = stopChoices(c, existing, legsByName, taken);
+  return choices.length > 1 ? 'ambiguous' : choices[0];
 }
 
 /** Candidates not already present as stops (by name, within their own city). */
diff --git a/tests/e2e/travel-reliability.spec.ts b/tests/e2e/travel-reliability.spec.ts
index 4be20da569ee8f0c274349d852f3ee25b1357a54..55540b3dc3aeae0b348769dca69a620706144fc2 100644
--- a/tests/e2e/travel-reliability.spec.ts
+++ b/tests/e2e/travel-reliability.spec.ts
@@ -217,7 +217,8 @@ test('ambiguous plan matches require a deliberate reuse or new-place decision',
         }),
         row('fortress', 'Fortress', sb, 2),
         row('b2', 'Belvedere', v2, 3),
-        row('alb-loose', 'Albertina', null, 4),
+        // The plan's name on the other Vienna leg: either could be the plan's Albertina.
+        row('alb-loose', 'Albertina', v2, 4),
       ]);
       await m.db.trips.update(trip, { planText: plan });
       return { trip, v1, sb, v2 };
@@ -256,7 +257,7 @@ test('ambiguous plan matches require a deliberate reuse or new-place decision',
     'Choose…',
     'Add as a new place',
     'My print room · Vienna · leg 1 · keep this record',
-    'Albertina · keep this record',
+    'Albertina · Vienna · leg 3 · keep this record',
   ]);
 
   // Cancelling writes nothing.
@@ -302,10 +303,10 @@ test('ambiguous plan matches require a deliberate reuse or new-place decision',
     ['Belvedere', t.v1, false],
     ['My print room', t.v1, false],
     ['Albertina', null, false],
-    ['Albertina', null, false],
     ['Fortress', t.sb, false],
     ['Mozart house', t.sb, false],
     ['Belvedere', t.v2, false],
+    ['Albertina', t.v2, false],
   ]);
 });
 
@@ -687,9 +688,58 @@ test('photo batch failures preserve committed records and retry without duplicat
     png,
   ]);
   // The Stop's photos, from first to last, are exactly as saved above.
+  const kept = [sha(existing), early, late, png, heic, webp];
   expect(
     (await photos()).filter((p) => p.stopId === t.stop && !p.momentId).map((p) => p.sha),
-  ).toEqual([sha(existing), early, late, png, heic, webp]);
+  ).toEqual(kept);
+
+  // More photos picked while some still wait: the waiting ones stay offered,
+  // on their own stop, and every photo is saved once.
+  const more = [3, 4, 5, 6, 7].map((d) => ({
+    name: `more-${d}.jpg`,
+    mimeType: 'image/jpeg',
+    buffer: jpegTakenAt(`2026:10:0${d} 10:00:00`, 2_000 + d),
+  }));
+  const [a, b, c, d, e] = more.map((f) => sha(f.buffer));
+  const other = await run(
+    page,
+    async (m, trip: string) => m.addStop(trip, 'Park Güell', null),
+    t.trip,
+  );
+  const onStop = async (stop: string) =>
+    (await photos())
+      .filter((p) => p.stopId === stop && !p.momentId)
+      .map((p) => p.sha)
+      .sort();
+  // Same-document moves, so the waiting photos are what the page still holds.
+  const open = (stop: string) =>
+    page.evaluate((h) => (location.hash = h), `#/trip/${t.trip}/stops/${stop}`);
+  await open(t.stop);
+  await failPhotoWrites(page, 1);
+  await library.setInputFiles(more.slice(0, 3));
+  await expect(alert).toContainText('1 photo saved; 2 not saved: Synthetic quota exceeded');
+  await allowPhotoWrites(page);
+  await library.setInputFiles(more[3]);
+  await expect.poll(() => onStop(t.stop)).toEqual([...kept, a, d].sort());
+  await expect(alert).toContainText('1 photo saved; 2 not saved');
+  await expect(page.getByRole('button', { name: 'Retry 2 photos' })).toBeVisible();
+
+  // Another stop's failed selection waits there, and leaves this one's alone.
+  await open(other);
+  await expect(alert).toHaveCount(0);
+  await failPhotoWrites(page, 0);
+  await library.setInputFiles(more[4]);
+  await expect(alert).toContainText('0 photos saved; 1 not saved');
+  await allowPhotoWrites(page);
+  await open(t.stop);
+  await page.getByRole('button', { name: 'Retry 2 photos' }).click();
+  await expect(alert).toHaveCount(0);
+  await expect.poll(() => onStop(t.stop)).toEqual([...kept, a, b, c, d].sort());
+  await open(other);
+  await page.getByRole('button', { name: 'Retry 1 photo' }).click();
+  await expect(alert).toHaveCount(0);
+  await expect.poll(() => onStop(other)).toEqual([e]);
+  expect(await onStop(t.stop)).toEqual([...kept, a, b, c, d].sort());
 });
 
 /** A stored ZIP's entries, read here rather than by the app's own reader. */
@@ -1188,7 +1238,8 @@ test('travel reliability family proof preserves identities and originals across
     ['Cathedral', t.sb, true],
   ];
   const checklist = [
-    ['Find the gate', true, true],
+    // Ticked by the traveller: theirs now, never retirable.
+    ['Find the gate', true, false],
     ['Old cue', false, false],
     ['Upper terrace', false, true],
   ];
diff --git a/tests/unit/compat.test.ts b/tests/unit/compat.test.ts
index 786ee7a0c7a4e086cbc5ddeb8e9fae6724c4f8f2..a16107745d256dbc0789f22459cece74c6ed31d5 100644
--- a/tests/unit/compat.test.ts
+++ b/tests/unit/compat.test.ts
@@ -518,6 +518,38 @@ it('repeated plan revisions retire only proven untouched generated checklist ite
   // Re-applying the same plan changes nothing.
   expect(revisedStop(three, rev3)).toEqual(three);
 
+  // A later plan happens to list the edited item's text and the unticked one,
+  // unticked: they stay, and are the traveller's from now on.
+  const rev4 = plan('Find the crypt door', 'Pre-booked', 'Ask for the roof');
+  const four = revisedStop(three, rev4);
+  expect(texts(four)).toEqual([
+    ['Buy tickets', true, true],
+    ['Old cue', false, false],
+    ['Light a candle', false, false],
+    ['Bring water', false, false],
+    ['Check the tower', false, false],
+    ['Find the crypt door', false, false],
+    ['Pre-booked', false, false],
+    ['Climb the dome', true, true],
+    ['Ask for the roof', false, true],
+  ]);
+  expect(revisedStop(four, rev4)).toEqual(four);
+  // The next plan drops all three: only the untouched generated one goes.
+  const roof = three.checklist.find((c) => c.text === 'Ask for the roof')!.id;
+  const five = revisedStop(four, plan());
+  expect(five.checklist.map((c) => c.id)).toEqual([
+    'buy',
+    'legacy',
+    'candle',
+    'water',
+    'tower',
+    'edited',
+    'unticked',
+    dome.id,
+  ]);
+  // Negative control: before the plan dropped it, the untouched one was there.
+  expect(four.checklist.map((c) => c.id)).toContain(roof);
+
   // No planSource (a record from an older version): nothing is retired, even
   // when the previous plan text lists the item.
   const legacy = { ...start, planSource: undefined };
diff --git a/tests/unit/plan-revision.test.ts b/tests/unit/plan-revision.test.ts
index ccbfaf064974d311ca17dea691873262df099fed..4cd77bed6b145ad2f223fc48e82e08e1f58aae6b 100644
--- a/tests/unit/plan-revision.test.ts
+++ b/tests/unit/plan-revision.test.ts
@@ -199,21 +199,40 @@ describe('revised routes', () => {
       ['Mozart house', 'Salzburg'],
       ['Belvedere', 'Vienna'],
     ]);
-    // Every plausible record, by name or by the name it was imported under.
-    // Fortress has one record: the first entry takes it, the second can't.
+    // Every plausible record, by name or by the name it was imported under. A
+    // record on the named city's leg comes before one with no leg; the renamed
+    // Albertina is found by its import name. Fortress has one record: the
+    // first entry takes it, the second can't.
     expect(planChoices(candidates, rows, vsv)).toEqual([
       ['b1', 'b2'],
-      ['alb', 'alb-loose'],
+      ['alb'],
       ['fortress'],
       [],
       [],
       ['b1', 'b2'],
     ]);
     // Review asks about ambiguity; only a true absence is a new place.
-    expect(reviewMatches(candidates, rows, vsv)).toEqual(['?', '?', 'fortress', '', '', '?']);
+    expect(reviewMatches(candidates, rows, vsv)).toEqual(['?', 'alb', 'fortress', '', '', '?']);
     expect(UNDECIDED).toBe('?');
-    // Unreviewed matching (the defect's view) would have shown all three as new.
-    expect(planMatches(candidates, rows, vsv)).toEqual(['', '', 'fortress', '', '', '']);
+    // Unreviewed matching (the defect's view) would have shown both Belvederes as new.
+    expect(planMatches(candidates, rows, vsv)).toEqual(['', 'alb', 'fortress', '', '', '']);
+
+    // An import name on one leg and the same name on the other: still ambiguous.
+    const aliasRows = [rows[1], place('alb2', 'Albertina', 'v2')];
+    expect(reviewMatches([candidates[1]], aliasRows, vsv)).toEqual(['?']);
+
+    // No city heading on a trip with several legs: the name can't say which
+    // leg, so any leg's record of that name may be it — never a new place.
+    const bare = extractStopsFromPlan('## Route\n### Museum\nHall', vsvNames);
+    expect(bare.map((c) => c.city)).toEqual([undefined]);
+    const museum = place('m1', 'Museum', 'sb');
+    expect(reviewMatches(bare, [museum], vsv)).toEqual(['m1']);
+    expect(reviewMatches(bare, [museum, place('m2', 'Museum', 'v2')], vsv)).toEqual(['?']);
+    // Unassigned and assigned alike: no heading gives one more evidence than the other.
+    expect(reviewMatches(bare, [museum, place('m0', 'Museum', null)], vsv)).toEqual(['?']);
+    // Twice in a headingless plan with one record: the first reuses it, the second is new.
+    const twice = extractStopsFromPlan('## Route\n### Museum\nA\n### Museum\nB', vsvNames);
+    expect(reviewMatches(twice, [museum], vsv)).toEqual(['m1', '']);
   });
 
   it('repeated-city plan logic never picks a leg a heading cannot name', () => {
@@ -269,6 +288,32 @@ describe('revised routes', () => {
       '?',
       '',
     ]);
+
+    // A place renamed by hand is still the one it was imported as, on every
+    // path: present for legacy import, backfilled, and reused by review.
+    const renamed = [
+      place('mine', 'My fortress', 'sb', {
+        planSource: { name: 'Fortress', notes: 'River', checklist: [] },
+      }),
+    ];
+    const fortress = '# Salzburg\n## Route\n### Fortress\nAnchor: Funicular';
+    expect(newStopCandidates(fortress, renamed, vsvNames, ids)).toEqual([]);
+    expect(guideBackfill(fortress, renamed, vsvNames, ids)).toEqual([
+      { id: 'mine', patch: { guide: { anchor: 'Funicular' } } },
+    ]);
+    expect(reviewMatches(extractStopsFromPlan(fortress, vsvNames), renamed, vsv)).toEqual(['mine']);
+    // Legacy presence and review agree on every case above.
+    for (const [text, rows] of [
+      [plan, imported],
+      [plan, later],
+      [graz, later],
+      [bare, later],
+      [fortress, renamed],
+    ] as const) {
+      const found = reviewMatches(extractStopsFromPlan(text, vsvNames), rows, vsv);
+      const fresh = newStopCandidates(text, rows, vsvNames, ids);
+      expect(fresh.length).toBe(found.filter((m) => m === '').length);
+    }
   });
 
   it('ignores nested commentary headings and recovers bold location labels', () => {
```

**Paths the rework touched:**

- `docs/travel-reliability-closure.md`
- `src/components/tabs/StopsTab.svelte`
- `src/lib/plan-revision.ts`
- `src/lib/stops.ts`
- `tests/e2e/travel-reliability.spec.ts`
- `tests/unit/compat.test.ts`
- `tests/unit/plan-revision.test.ts`

**The builder's rework commit messages — claims to verify against the diff, never evidence:**

```
d771123 Rework three invariant families after the requested changes

Family proof plan: docs/travel-reliability-closure.md ("Family proof plan",
"Readers and writers", "Limits").

Safe checklist retirement across revisions and personal edits
  Invariant: a plan may retire only an item it wrote that still reads
  exactly as written. The fromPlan mark is that proof only while it holds,
  so a later plan whose text happens to match a changed item must not
  re-establish it.
  - revisedStop: fixed. When the new plan lists an item, the item keeps its
    mark only if it matches both the outgoing and the new plan's listing
    (text and tick). Otherwise the mark is dropped and the item belongs to
    the traveller.
  - toggleChecklistItem: fixed. A tick or untick by hand drops the mark.
  - planItem, import and new rows in apply: checked clean. They mark only
    what the plan writes.
  - addChecklistItem and deleteChecklistItem: checked clean. Added items
    are unmarked; deletion is unchanged.
  - Validation, ZIP, old and new merge: checked clean. The mark is still
    optional, and dropping it is an ordinary field change.
  - Limit: an older app ticks without dropping the mark. The content rule
    still protects an item that was ticked when written, or whose text was
    changed.

Consistent Stop identity and ambiguity across reviewed and legacy plan paths
  Invariant: every path that asks "which existing record is this plan
  entry?" gets the same answer.
  - The rule: match on the name or the import name. A named city's legs
    come first, then records with no leg. A city with no leg left matches
    only records with no leg. With no city heading, a record on any leg can
    match.
  - The rule now lives in one function, stopChoices in stops.ts.
  - planChoices, planMatches, reviewMatches, planRetained and
    savePlanRevision's prior matches: fixed. They go through stopChoices,
    so a headingless entry on a multi-leg trip reuses its only record or
    asks betw
… (truncated)
```

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

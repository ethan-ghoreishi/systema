<script lang="ts">
  import { untrack } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db, type Moment, type Stop, type StopGuide, type Trip } from '../../lib/db';
  import {
    addStop,
    updateStop,
    deleteStop,
    toggleVisited,
    setVisitTime,
    placeStop,
    moveStop,
    addChecklistItem,
    toggleChecklistItem,
    deleteChecklistItem,
    checklistProgress,
    importStopsFromPlan,
    newStopCandidates,
    returnToRoute,
    cityIds,
    legLabel,
  } from '../../lib/stops';
  import { addPhotos, PhotoBatchError, photoTime } from '../../lib/photos';
  import { instantToWall, wallToInstant, wallLabel } from '../../lib/tz';
  import {
    GONE,
    stopGroups,
    visitedPlaces,
    zoneOf,
    compareMoments,
    momentWhen,
  } from '../../lib/moments';
  import { hasPin, mapsLink } from '../../lib/maps';
  import { tripEndIso } from '../../lib/trip-shape';
  import PhotoGallery from '../PhotoGallery.svelte';
  import PhotoPicker from '../PhotoPicker.svelte';
  import MomentCapture from '../MomentCapture.svelte';
  import { router, navigate } from '../../lib/router.svelte';
  import { recall, remember } from '../../lib/ui-memory';
  import Icon from '../Icon.svelte';
  import StopsMap from '../StopsMap.svelte';
  import PlanRevision from '../PlanRevision.svelte';
  let reviewingPlan = $state(false);

  let { trip }: { trip: Trip } = $props();

  // Views are kept per trip; the planned list and map never follow visit order.
  const viewKey = untrack(() => `stops:${trip.id}:view`);
  let stopView = $state<'list' | 'map' | 'visited'>(recall(viewKey, 'list'));
  let editingOrder = $state(false);
  $effect(() => remember(viewKey, stopView));
  function viewKeydown(e: KeyboardEvent) {
    const views = ['list', 'map', 'visited'] as const;
    const i = views.indexOf(stopView);
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % 3
        : e.key === 'ArrowLeft'
          ? (i + 2) % 3
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? 2
              : -1;
    if (next < 0) return;
    e.preventDefault();
    stopView = views[next];
    (e.currentTarget as HTMLElement)
      .querySelector<HTMLButtonElement>(`#stops-view-${stopView}`)
      ?.focus();
  }

  // The stop just opened gets focus back when the list returns.
  let returnFocus = $state<string | null>(null);
  function focusReturn(node: HTMLElement, on: boolean) {
    if (!on) return;
    node.focus({ preventScroll: true });
    returnFocus = null;
  }

  const stopsQ = liveQuery(() => db.stops.where('tripId').equals(trip.id).sortBy('order'));
  const citiesQ = liveQuery(() => db.cities.where('tripId').equals(trip.id).sortBy('order'));
  const photosQ = liveQuery(() => db.photos.where('tripId').equals(trip.id).toArray());
  const momentsQ = liveQuery(() => db.moments.where('tripId').equals(trip.id).sortBy('at'));
  const moments = $derived([...($momentsQ ?? [])].sort(compareMoments));
  let editingMoment = $state<Moment | null>(null);
  const stops = $derived($stopsQ ?? []);
  const plannedStops = $derived(stops.filter((s) => !s.offPlan));
  const cities = $derived($citiesQ ?? []);
  const allPhotos = $derived($photosQ ?? []);
  const history = $derived(visitedPlaces(stops, cities));
  const visitNumber = $derived(new Map(history.timed.map((s, i) => [s.id, i + 1])));
  const stamp = (s: Stop) =>
    s.visitedAt == null
      ? 'Visit time unknown'
      : wallLabel(instantToWall(s.visitedAt, zoneOf(s, cities)));

  const cityNameById = $derived(new Map(cities.map((c) => [c.id, c.name])));
  // Headers for two legs or more, as before — and for a trip holding anything
  // left over from a deleted leg, whatever it has left. A one-leg trip whose
  // stops were never put on a leg stays the plain list it has always been.
  const grouped = $derived(
    cities.length >= 2 || [...stops, ...moments].some((r) => r.legName && !r.cityId),
  );
  const groupLabel = (key: string | null) =>
    key?.startsWith(GONE)
      ? `${key.slice(GONE.length)} · leg deleted`
      : (key && cityNameById.get(key)) || 'Unassigned';

  type StopRow =
    | { kind: 'header'; label: string }
    | { kind: 'stop'; stop: Stop; index: number }
    | { kind: 'moment'; moment: Moment };
  /** The list, as `stopGroups` orders it, with the move buttons' own indices. */
  const stopRows = $derived.by<StopRow[]>(() => {
    const indexOf = new Map(plannedStops.map((s, i) => [s.id, i]));
    const rows: StopRow[] = [];
    for (const group of stopGroups(plannedStops, moments, cities)) {
      if (grouped) rows.push({ kind: 'header', label: groupLabel(group.key) });
      for (const it of group.items)
        rows.push(
          it.kind === 'stop'
            ? { kind: 'stop', stop: it.stop, index: indexOf.get(it.stop.id)! }
            : { kind: 'moment', moment: it.moment },
        );
    }
    return rows;
  });

  const stopNameById = $derived(new Map(stops.map((s) => [s.id, s.name])));

  function momentTime(m: Moment): string {
    return momentWhen(m, cities, true);
  }

  // Detail selection via the route: #/trip/:id/stops/:stopId
  const selectedId = $derived(router.path.split('/').filter(Boolean)[3] ?? null);
  const selected = $derived(selectedId ? (stops.find((s) => s.id === selectedId) ?? null) : null);

  // Stops found in the plan that aren't in the list yet (dedupe by name), so
  // extraction can merge safely at any time, not just into an empty list.
  const extractable = $derived(
    $stopsQ
      ? newStopCandidates(
          trip.planText,
          stops,
          cities.map((c) => c.name),
          cityIds(cities),
        )
      : [],
  );

  const photoCounts = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const p of allPhotos) if (p.stopId) m[p.stopId] = (m[p.stopId] ?? 0) + 1;
    return m;
  });

  const photos = $derived(
    allPhotos.filter((p) => p.stopId === selectedId).sort((a, b) => photoTime(a) - photoTime(b)),
  );
  // Transient "Saved ✓" indicator shared by all autosaving fields here.
  let savedAt = $state<number | null>(null);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  function flashSaved() {
    if (draftBlocked) return;
    savedAt = Date.now();
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (savedAt = null), 2000);
  }

  $effect(() => {
    if (selectedId && draftsFor === selectedId && $stopsQ && !selected) {
      draftBlocked = true;
      failed(new Error('This stop was deleted elsewhere. Your unsaved drafts are below'));
    }
  });

  // ---- list ----
  let newStopName = $state('');
  // The leg a new stop joins: the one the planned route ends in (places kept
  // off the route say nothing about where the trip is), the only leg, or —
  // with several legs and no route yet — none until one is chosen. The
  // choice stays for the next stop; each can still be moved on the stop itself.
  let pickedLeg = $state<string | null | undefined>(undefined);
  const newStopLeg = $derived(
    pickedLeg !== undefined && (pickedLeg === null || cityNameById.has(pickedLeg))
      ? pickedLeg
      : plannedStops.length
        ? (plannedStops[plannedStops.length - 1].cityId ?? null)
        : cities.length === 1
          ? cities[0].id
          : null,
  );
  async function addStopNow() {
    if (!newStopName.trim()) return;
    const name = newStopName;
    newStopName = '';
    try {
      await addStop(trip.id, name, newStopLeg);
    } catch (err) {
      newStopName = name;
      failed(err);
    }
  }
  async function extractNow() {
    const n = await importStopsFromPlan(trip.id, trip.planText, stops, cities);
    if (n > 0) flashSaved();
  }
  function openStop(s: Stop) {
    returnFocus = s.id;
    navigate(`/trip/${trip.id}/stops/${s.id}`);
  }
  function backToList() {
    const list = `/trip/${trip.id}/stops`;
    router.back(list, (p) => p === list);
  }

  // Persist input immediately, bound to the currently selected stop.
  let nameDraft = $state('');
  let notesDraft = $state('');
  let nameBase = '';
  let notesBase = '';
  let pinBase: Pick<Stop, 'lat' | 'lng'> = {};
  let draftBlocked = $state(false);
  let draftsFor = $state<string | null>(null);
  // This tab stays mounted while the detail opens and closes, so the guard has
  // to clear when there is no stop in the route. Otherwise reopening the same
  // stop keeps the drafts from last time — and a stop edited in between (a
  // synced note, a restored backup) would have that edit typed back over.
  // Keyed on the route, not on the record: a stop momentarily absent while the
  // live query reloads must not wipe what is being typed.
  $effect(() => {
    if (!selectedId) {
      draftsFor = null;
      return;
    }
    if (selected && draftsFor !== selected.id) {
      editingGuide = false;
      nameDraft = selected.name;
      notesDraft = selected.notes;
      nameBase = selected.name;
      notesBase = selected.notes;
      draftBlocked = false;
      saveError = '';
      draftsFor = selected.id;
    }
  });

  let saveError = $state('');
  let editingVisit = $state(false);
  let visitDraft = $state('');
  let latDraft = $state('');
  let lngDraft = $state('');
  let locationFor = $state<string | null>(null);
  // Same guard, same reason: a pin dragged on the map after this stop was last
  // open must be what the fields show, or Save map location puts the old
  // coordinates back over the move.
  $effect(() => {
    if (!selectedId) {
      locationFor = null;
      return;
    }
    if (selected && locationFor !== selected.id) {
      locationFor = selected.id;
      latDraft = selected.lat?.toString() ?? '';
      lngDraft = selected.lng?.toString() ?? '';
      pinBase = { lat: selected.lat, lng: selected.lng };
      editingVisit = false;
    }
  });
  async function changeVisitTime() {
    if (!selected) return;
    const tz = zoneOf(selected, cities);
    // Visits are kept to the minute. Trimming any seconds the picker supplies
    // keeps the round-trip check comparing like with like.
    const wall = visitDraft.slice(0, 16);
    const at = wallToInstant(wall, tz);
    if (at == null || instantToWall(at, tz) !== wall) {
      saveError =
        'Enter a valid local visit date and time. This time may not exist because the clocks changed.';
      return;
    }
    saveError = '';
    try {
      await setVisitTime(selected.id, at);
      editingVisit = false;
      flashSaved();
    } catch (err) {
      failed(err);
    }
  }
  async function saveLocation() {
    if (!selected || draftBlocked) return;
    const pos = { lat: Number(latDraft), lng: Number(lngDraft) };
    if (!latDraft.trim() || !lngDraft.trim() || !hasPin(pos)) {
      saveError = 'Enter latitude from −90 to 90 and longitude from −180 to 180.';
      return;
    }
    saveError = '';
    try {
      await placeStop(selected.id, pos, pinBase);
      pinBase = pos;
      flashSaved();
    } catch (err) {
      draftFailed(err);
    }
  }
  async function markVisited(s: Stop) {
    saveError = '';
    try {
      // A historical marking says we went, not that we went today. The trip's
      // end date comes from its legs; `endDate` is only the fallback.
      const today = instantToWall(Date.now(), zoneOf(s, cities)).slice(0, 10);
      const end = tripEndIso(trip, cities);
      await toggleVisited(s, trip.status === 'done' || (end && end < today) ? null : Date.now());
    } catch (err) {
      failed(err);
    }
  }
  function failed(err: unknown) {
    savedAt = null;
    saveError = `Not saved: ${err instanceof Error ? err.message : String(err)}. Copy your text before leaving.`;
  }
  // Only the fields being typed are held back: an unrelated write failing is
  // no reason to make the traveller discard a draft that never conflicted.
  function draftFailed(err: unknown) {
    draftBlocked = true;
    failed(err);
  }
  function saveName() {
    if (!selected || draftBlocked) return;
    saveError = '';
    const name = nameDraft.trim() || 'Untitled stop';
    const saving = updateStop(selected.id, { name }, { name: nameBase });
    nameBase = name;
    void saving.then(flashSaved).catch(draftFailed);
  }

  function saveCity(cityId: string | null) {
    if (!selected) return;
    saveError = '';
    void updateStop(selected.id, { cityId }).then(flashSaved).catch(failed);
  }

  function saveNotes() {
    if (!selected || draftBlocked) return;
    saveError = '';
    const saving = updateStop(selected.id, { notes: notesDraft }, { notes: notesBase });
    notesBase = notesDraft;
    void saving.then(flashSaved).catch(draftFailed);
  }

  function reloadDetails() {
    if (!selected) return;
    nameDraft = nameBase = selected.name;
    notesDraft = notesBase = selected.notes;
    pinBase = { lat: selected.lat, lng: selected.lng };
    latDraft = selected.lat?.toString() ?? '';
    lngDraft = selected.lng?.toString() ?? '';
    draftBlocked = false;
    saveError = '';
  }

  async function clearVisitTime() {
    if (!selected) return;
    try {
      await setVisitTime(selected.id, null);
      editingVisit = false;
      flashSaved();
    } catch (err) {
      failed(err);
    }
  }

  // ---- detail: visit anchor ----
  let editingGuide = $state(false);
  const hasGuide = (g?: StopGuide) =>
    !!g && Object.values(g).some((v) => (Array.isArray(v) ? v.length : v));
  function saveGuide(key: keyof StopGuide, value: string) {
    if (!selected) return;
    const guide: StopGuide = { ...selected.guide };
    if (key === 'lookFor')
      guide.lookFor = value
        .split(/\n|;/)
        .map((v) => v.trim())
        .filter(Boolean);
    else guide[key] = value.trim() || undefined;
    saveError = '';
    void updateStop(selected.id, { guide }).then(flashSaved).catch(failed);
  }

  // ---- detail: photos + checklist ----
  // Photos of a batch that stopped part-way, kept to retry for that stop only.
  let unsaved = $state<{ stopId: string; files: Blob[]; saved: number; reason: string } | null>(
    null,
  );
  async function onPhotos(files: Blob[]) {
    if (!selected) return;
    const stopId = selected.id;
    const tz = zoneOf(selected, cities);
    unsaved = null;
    try {
      await addPhotos(files, { tripId: trip.id, stopId, kind: 'stop', tz });
      flashSaved();
    } catch (err) {
      // What saved stays saved; only the rest is offered again, so nothing is added twice.
      unsaved =
        err instanceof PhotoBatchError
          ? { stopId, files: err.remaining, saved: err.saved.length, reason: err.message }
          : { stopId, files, saved: 0, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  let newItemText = $state('');
  async function addItem() {
    if (!selected) return;
    await addChecklistItem(selected, newItemText);
    newItemText = '';
    flashSaved();
  }

  async function removeStop() {
    if (!selected) return;
    const linked = moments.filter((m) => m.stopId === selected.id).length;
    if (
      confirm(
        `Delete stop “${selected.name}”? Its photos go with it.` +
          (linked ? ` ${linked} moment(s) that are part of it stay, with their photos.` : ''),
      )
    ) {
      const id = selected.id;
      backToList();
      await deleteStop(id);
    }
  }
</script>

{#snippet visitedRow(s: Stop)}
  <button class="stop-row" onclick={() => openStop(s)} use:focusReturn={returnFocus === s.id}>
    <span class="stop-name"
      >{visitNumber.has(s.id) ? `${visitNumber.get(s.id)}. ` : ''}{s.name}</span
    >
    <span class="stop-meta"
      >{stamp(s)} · {groupLabel(s.cityId || (s.legName ? GONE + s.legName : null))}</span
    >
  </button>
{/snippet}

{#if selected}
  {@const destination = mapsLink(selected, cities)}
  <!-- Detail -->
  <div class="stop-detail">
    <div class="detail-bar">
      <span class="autosave" class:autosave--on={savedAt}>
        {draftBlocked ? 'Autosave paused' : savedAt ? 'Saved ✓' : 'Saves automatically'}
      </span>
    </div>

    {#if saveError}<p role="alert" class="hint hint--warn">{saveError}</p>{/if}
    {#if draftBlocked}<button class="btn btn--ghost" onclick={reloadDetails}
        >Reload saved details (discards draft)</button
      >{/if}
    <input
      class="field stop-name-input"
      aria-label="Stop name"
      bind:value={nameDraft}
      oninput={saveName}
    />

    <a class="btn btn--primary" href={destination.href} target="_blank" rel="noopener noreferrer"
      >{destination.label}</a
    >
    <p class="hint">
      {hasPin(selected)
        ? 'Directions use the saved pin. Check the entrance in Google Maps.'
        : 'Searches by name and city. Check the place in Google Maps before setting off.'}
      {#if hasPin(selected)}<a
          href={mapsLink(selected, cities, true).href}
          target="_blank"
          rel="noopener noreferrer">Find by name instead</a
        >{/if}
    </p>

    <label class="switch">
      <input type="checkbox" checked={selected.visited} onchange={() => markVisited(selected)} />
      <span>Visited</span>
    </label>

    {#if selected.visited}
      <div class="visit-time">
        <span class="hint">{stamp(selected)}</span>
        <button
          class="link-btn"
          onclick={() => {
            visitDraft =
              selected.visitedAt == null
                ? ''
                : instantToWall(selected.visitedAt, zoneOf(selected, cities));
            editingVisit = !editingVisit;
          }}>Change visit time</button
        >
      </div>
      {#if editingVisit}
        <form
          class="visit-editor"
          onsubmit={(e) => {
            e.preventDefault();
            void changeVisitTime();
          }}
        >
          <label class="label" for="visit-time">Actual visit time</label>
          <input
            id="visit-time"
            class="field"
            type="datetime-local"
            required
            bind:value={visitDraft}
          />
          <p class="hint">
            {zoneOf(selected, cities) || 'Device local time'}. Use when you were there, even if you
            marked it later. This changes visit history, leaving the plan in its own order.
          </p>
          <button class="btn btn--ghost" type="submit">Save visit time</button>
          {#if selected.visitedAt != null}<button
              class="link-btn"
              type="button"
              onclick={clearVisitTime}>Clear visit time</button
            >{/if}
        </form>
      {/if}
    {/if}

    {#if moments.some((m) => m.stopId === selected.id)}
      <section aria-label="Moments at this place">
        <h2 class="section-title">Moments at this place</h2>
        {#each moments.filter((m) => m.stopId === selected.id) as m (m.id)}
          <button class="link-btn" onclick={() => (editingMoment = m)}>{m.title}</button>
        {/each}
      </section>
    {/if}

    {#if selected.booked || selected.bookingRef?.trim()}
      <section class="card" aria-label="Booking record">
        <h2 class="section-title">Booking record</h2>
        <p>{selected.bookingRef ? `Reference: ${selected.bookingRef}` : 'Reserved'}</p>
        {#if selected.offPlan}<p class="hint">
            This place is off the current route. Its reservation has been kept; changing the plan
            does not cancel a booking.
          </p>{/if}
      </section>
    {/if}

    <details class="stop-location">
      <summary>Map location</summary>
      <p class="hint">
        The saved pin is used for directions. Correct it here or drag it on the map.
      </p>
      <form
        class="visit-editor"
        onsubmit={(e) => {
          e.preventDefault();
          void saveLocation();
        }}
      >
        <label class="label" for="stop-lat">Latitude</label>
        <input id="stop-lat" class="field" type="text" inputmode="decimal" bind:value={latDraft} />
        <label class="label" for="stop-lng">Longitude</label>
        <input id="stop-lng" class="field" type="text" inputmode="decimal" bind:value={lngDraft} />
        <button class="btn btn--ghost" type="submit">Save map location</button>
        {#if hasPin(selected)}<button
            class="link-btn"
            type="button"
            onclick={() => {
              if (selected && !draftBlocked)
                void placeStop(selected.id, null, pinBase)
                  .then(() => {
                    pinBase = { lat: undefined, lng: undefined };
                    latDraft = '';
                    lngDraft = '';
                    flashSaved();
                  })
                  .catch(draftFailed);
            }}>Remove map location</button
          >{/if}
      </form>
    </details>

    {#if cities.length > 0}
      <div>
        <label class="label" for="stop-city">Leg</label>
        <select
          id="stop-city"
          class="field"
          value={selected.cityId && cityNameById.has(selected.cityId) ? selected.cityId : ''}
          onchange={(e) => saveCity((e.currentTarget as HTMLSelectElement).value || null)}
        >
          {#each cities as c (c.id)}
            <option value={c.id}>{legLabel(c, cities)}</option>
          {/each}
          <option value="">Unassigned</option>
        </select>
      </div>
    {/if}

    {#if hasGuide(selected.guide) || editingGuide}
      <section class="card anchor" aria-label="Visit anchor">
        <div class="anchor-head">
          <span class="section-title">Visit anchor</span>
          <button class="link-btn" onclick={() => (editingGuide = !editingGuide)}
            >{editingGuide ? 'Done' : 'Edit'}</button
          >
        </div>
        {#if editingGuide}
          {#each [['anchor', 'Anchor — where to begin, and why'], ['minimum', 'Minimum visit — the 10–20 minute version'], ['lookFor', 'Look for — three cues, one per line'], ['stretch', 'Stretch — only if calm and ahead'], ['exit', 'Exit rule — what can be skipped']] as const as [key, label] (key)}
            <label class="label" for={`guide-${key}`}>{label}</label>
            <textarea
              id={`guide-${key}`}
              class="field"
              rows="2"
              value={key === 'lookFor'
                ? (selected.guide?.lookFor ?? []).join('\n')
                : (selected.guide?.[key] ?? '')}
              onchange={(e) => saveGuide(key, (e.currentTarget as HTMLTextAreaElement).value)}
            ></textarea>
          {/each}
        {:else}
          {@const g = selected.guide!}
          {#if g.anchor}<p><strong>Begin:</strong> {g.anchor}</p>{/if}
          {#if g.minimum}<p><strong>Minimum visit:</strong> {g.minimum}</p>{/if}
          {#if g.lookFor?.length}
            <div>
              <strong>Look for</strong>
              <ul class="anchor-cues">
                {#each g.lookFor as cue (cue)}<li>{cue}</li>{/each}
              </ul>
            </div>
          {/if}
          {#if g.stretch}<p class="hint"><strong>Stretch, if calm:</strong> {g.stretch}</p>{/if}
          {#if g.exit}<p class="hint"><strong>Can skip:</strong> {g.exit}</p>{/if}
        {/if}
      </section>
    {:else}
      <button class="link-btn anchor-add" onclick={() => (editingGuide = true)}
        >Add a visit anchor</button
      >
    {/if}

    <div>
      <label class="label" for="stop-notes">Notes</label>
      <textarea
        id="stop-notes"
        class="field stop-notes"
        rows="6"
        placeholder="Paste the system reading, the London and Esfahan contrasts, anything you want to glance at here."
        bind:value={notesDraft}
        oninput={saveNotes}></textarea>
    </div>

    <div>
      <span class="label">Checklist</span>
      <div class="checklist">
        {#each selected.checklist as item (item.id)}
          <div class="check-item" class:check-item--done={item.done}>
            <button
              class="check-box"
              aria-label={item.done ? 'Mark not done' : 'Mark done'}
              onclick={() => toggleChecklistItem(selected, item.id)}
            >
              {#if item.done}<Icon name="check" size={16} />{/if}
            </button>
            <span class="check-text">{item.text}</span>
            <button
              class="icon-btn icon-btn--sm"
              aria-label="Remove item"
              onclick={() => deleteChecklistItem(selected, item.id)}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        {/each}
      </div>
      <form
        class="add-row"
        onsubmit={(e) => {
          e.preventDefault();
          addItem();
        }}
      >
        <input class="field" placeholder="Add a discovery item" bind:value={newItemText} />
        <button class="icon-btn" type="submit" aria-label="Add item"><Icon name="plus" /></button>
      </form>
    </div>

    <div>
      <span class="label">Photos</span>
      {#if photos.length}
        <PhotoGallery {photos} label={selected.name} />
      {/if}
      {#if unsaved?.stopId === selected.id}
        {@const left = unsaved.files}
        <p role="alert" class="hint hint--warn">
          {unsaved.saved} photo{unsaved.saved === 1 ? '' : 's'} saved; {left.length} not saved: {unsaved.reason}.
          Free some space if storage is full, then retry. The photos already saved stay as they are.
        </p>
        <button class="btn btn--ghost" onclick={() => onPhotos(left)}
          >Retry {left.length} photo{left.length === 1 ? '' : 's'}</button
        >
      {/if}
      <PhotoPicker onFiles={onPhotos} />
      <p class="hint">
        Stored on this device (and your NAS, if set up). Deleting a photo also removes it from this
        trip's journal and future backups.
      </p>
    </div>

    <div class="save-bar">
      <button class="btn btn--primary" onclick={backToList}>Done</button>
      <button class="btn btn--danger" onclick={removeStop} aria-label="Delete stop">
        <Icon name="trash" size={18} />
      </button>
    </div>
  </div>
{:else if selectedId && draftsFor === selectedId && $stopsQ}
  <div class="stop-detail">
    <p role="alert" class="hint hint--warn">{saveError}</p>
    <p class="hint">
      Autosave paused. Copy anything you want to keep before leaving. The stop has not been
      recreated.
    </p>
    <label class="label" for="deleted-name">Stop name draft</label>
    <input id="deleted-name" class="field" value={nameDraft} readonly />
    <label class="label" for="deleted-notes">Notes draft</label>
    <textarea id="deleted-notes" class="field" rows="4" value={notesDraft} readonly></textarea>
    <label class="label" for="deleted-lat">Latitude draft</label>
    <input id="deleted-lat" class="field" value={latDraft} readonly />
    <label class="label" for="deleted-lng">Longitude draft</label>
    <input id="deleted-lng" class="field" value={lngDraft} readonly />
    <button class="btn btn--primary" onclick={backToList}>Back to Stops</button>
  </div>
{:else}
  <!-- List / Map -->
  <div class="stops">
    {#if saveError}<p role="alert" class="hint hint--warn">{saveError}</p>{/if}
    {#if stops.length > 0 || moments.length > 0}
      <div
        class="segmented stops-toggle"
        role="tablist"
        tabindex="-1"
        aria-label="Stops view"
        onkeydown={viewKeydown}
      >
        <button
          class="segment"
          class:segment--on={stopView === 'list'}
          role="tab"
          id="stops-view-list"
          aria-controls="stops-panel"
          tabindex={stopView === 'list' ? 0 : -1}
          aria-selected={stopView === 'list'}
          onclick={() => (stopView = 'list')}>List</button
        >
        <button
          class="segment"
          class:segment--on={stopView === 'map'}
          role="tab"
          id="stops-view-map"
          aria-controls="stops-panel"
          tabindex={stopView === 'map' ? 0 : -1}
          aria-selected={stopView === 'map'}
          onclick={() => (stopView = 'map')}>Map</button
        >
        <button
          class="segment"
          class:segment--on={stopView === 'visited'}
          role="tab"
          id="stops-view-visited"
          aria-controls="stops-panel"
          tabindex={stopView === 'visited' ? 0 : -1}
          aria-selected={stopView === 'visited'}
          onclick={() => (stopView = 'visited')}>Visited</button
        >
      </div>
    {/if}

    <div
      id="stops-panel"
      role="tabpanel"
      aria-labelledby={stops.length || moments.length ? `stops-view-${stopView}` : undefined}
    >
      {#if stopView === 'map' && (stops.length > 0 || moments.length > 0)}
        <StopsMap
          {stops}
          {moments}
          {cities}
          onOpen={openStop}
          memoryKey={`stops:${trip.id}:map-city`}
        />
      {:else if stopView === 'visited' && (stops.length > 0 || moments.length > 0)}
        <h2 class="section-title">Places visited</h2>
        <p class="hint">
          Places you marked visited. Moments are kept separately below. Open a place to correct or
          clear its visit time.
        </p>
        <div class="stop-list visit-history">
          {#if history.timed.length}
            <h3 class="section-title">Recorded visit times</h3>
            <p class="hint">
              In recorded time order.{history.untimed.length
                ? ' Numbering covers these places only; untimed visits may fall anywhere.'
                : ''} A tap records the marking time unless corrected.
            </p>
            {#each history.timed as s (s.id)}
              {@render visitedRow(s)}
            {/each}
          {/if}
          {#if history.untimed.length}
            <h3 class="section-title">Visit time unknown</h3>
            <p class="hint">
              Grouped by leg, listed in planned order for reference. Actual visit order is unknown.
            </p>
            {#each history.untimed as group (group.key)}
              <h4 class="stop-city-head section-title">{groupLabel(group.key)}</h4>
              {#each group.stops as s (s.id)}
                {@render visitedRow(s)}
              {/each}
            {/each}
          {/if}
          {#if !history.timed.length && !history.untimed.length}
            <p class="hint">
              No places marked visited yet. Mark a place in List; a Moment does not mark its linked
              place visited.
            </p>
          {/if}
        </div>
        {#if moments.length}
          <h2 class="section-title">Moments</h2>
          <p class="hint">
            Observations, experiences and discoveries. Known dates first; unknown event times last,
            without an implied order.
          </p>
          <div class="stop-list moment-history">
            {#each moments as m (m.id)}
              <button class="stop-row moment-row" onclick={() => (editingMoment = m)}>
                <span class="stop-name">{m.title}</span>
                <span class="stop-meta"
                  >{momentWhen(m, cities)} · {groupLabel(
                    m.cityId || (m.legName ? GONE + m.legName : null),
                  )}{m.stopId && stopNameById.has(m.stopId)
                    ? ` · at ${stopNameById.get(m.stopId)}`
                    : ' · standalone'}</span
                >
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        {#if stops.length}<div class="stops-list-heading">
            <span class="hint">Planned order · unvisited places stay here for another visit.</span
            ><button
              class="link-btn"
              aria-pressed={editingOrder}
              onclick={() => (editingOrder = !editingOrder)}
              >{editingOrder ? 'Done reordering' : 'Reorder plan'}</button
            >
          </div>{/if}
        {#if stops.length && trip.planText.trim()}
          <button class="btn btn--ghost" onclick={() => (reviewingPlan = true)}
            >Review Stops from plan</button
          >
        {/if}
        {#if extractable.length > 0 && !stops.length}
          <button class="btn btn--ghost" onclick={extractNow}>
            {stops.length === 0
              ? `Extract ${extractable.length} stops from the plan`
              : `Add ${extractable.length} new stop${extractable.length > 1 ? 's' : ''} found in the plan`}
          </button>
        {/if}

        <form
          class="add-row"
          onsubmit={(e) => {
            e.preventDefault();
            addStopNow();
          }}
        >
          <input class="field" placeholder="Add a stop" bind:value={newStopName} />
          {#if cities.length >= 2}
            <select
              class="field"
              aria-label="Leg for the new stop"
              value={newStopLeg ?? ''}
              onchange={(e) => (pickedLeg = (e.currentTarget as HTMLSelectElement).value || null)}
            >
              {#each cities as c (c.id)}
                <option value={c.id}>{legLabel(c, cities)}</option>
              {/each}
              <option value="">Unassigned</option>
            </select>
          {/if}
          <button class="icon-btn" type="submit" aria-label="Add stop"><Icon name="plus" /></button>
        </form>

        {#if stops.some((s) => s.offPlan)}
          <details class="card">
            <summary>Kept off the route ({stops.filter((s) => s.offPlan).length})</summary>
            <p class="hint">
              Omitted from the revised route. All personal information and history is kept.
            </p>
            {#each stops.filter((s) => s.offPlan) as s (s.id)}
              <div class="cluster">
                <button class="link-btn" onclick={() => openStop(s)}
                  >{s.name}{s.visited ? ' · visited' : ''}</button
                >
                <button class="btn btn--ghost btn--sm" onclick={() => returnToRoute(s.id)}
                  >Return to route</button
                >
              </div>
            {/each}
          </details>
        {/if}
        {#if stopRows.length}
          <div class="stop-list">
            {#each stopRows as row, ri (row.kind === 'stop' ? row.stop.id : row.kind === 'moment' ? `m-${row.moment.id}` : `h-${ri}-${row.label}`)}
              {#if row.kind === 'header'}
                <span class="stop-city-head section-title">{row.label}</span>
              {:else if row.kind === 'moment'}
                {@const m = row.moment}
                {@const n = allPhotos.filter((p) => p.momentId === m.id).length}
                <div class="stop-row moment-row">
                  <span class="check-box check-box--none" aria-hidden="true"></span>
                  <button class="stop-open" onclick={() => (editingMoment = m)}>
                    <span class="stop-name">{m.title}</span>
                    <span class="stop-meta"
                      >{m.stopId && stopNameById.get(m.stopId)
                        ? `at ${stopNameById.get(m.stopId)}`
                        : 'off-plan'} · {momentTime(m)}{n
                        ? ` · ${n} photo${n > 1 ? 's' : ''}`
                        : ''}</span
                    >
                  </button>
                </div>
              {:else}
                {@const s = row.stop}
                {@const link = mapsLink(s, cities)}
                {@const i = row.index}
                {@const p = checklistProgress(s)}
                <div class="stop-row" class:stop-row--visited={s.visited}>
                  <button
                    class="check-box"
                    aria-label={s.visited ? 'Mark not visited' : 'Mark visited'}
                    onclick={() => markVisited(s)}
                  >
                    {#if s.visited}<Icon name="check" size={16} />{/if}
                  </button>
                  <button
                    class="stop-open"
                    onclick={() => openStop(s)}
                    use:focusReturn={returnFocus === s.id}
                  >
                    <span class="stop-name">{s.name}</span>
                    <span class="stop-meta">
                      {#if s.visited}{visitNumber.has(s.id)
                          ? `Visit ${visitNumber.get(s.id)} · `
                          : ''}{stamp(s)} ·
                      {/if}
                      {#if hasGuide(s.guide)}<span class="stop-anchor">anchor</span>
                        {#if s.notes.trim() || checklistProgress(s).total || photoCounts[s.id]}·
                        {/if}{/if}
                      {#if s.notes.trim()}notes{/if}
                      {#if p.total}{s.notes.trim() ? ' · ' : ''}{p.done}/{p.total} ticked{/if}
                      {#if photoCounts[s.id]}{s.notes.trim() || p.total ? ' · ' : ''}{photoCounts[
                          s.id
                        ]} photo{photoCounts[s.id] > 1 ? 's' : ''}{/if}
                    </span>
                  </button>
                  <a
                    class="btn btn--ghost btn--sm stop-go"
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${hasPin(s) ? 'Go to' : 'Find'} ${s.name} in Google Maps`}
                    >{hasPin(s) ? 'Go' : 'Find'}</a
                  >
                  {#if editingOrder}<div class="stop-reorder">
                      <button
                        class="icon-btn icon-btn--sm"
                        aria-label="Move up"
                        disabled={i === 0}
                        onclick={() => moveStop(plannedStops, i, -1)}
                        ><Icon name="up" size={18} /></button
                      >
                      <button
                        class="icon-btn icon-btn--sm"
                        aria-label="Move down"
                        disabled={i === plannedStops.length - 1}
                        onclick={() => moveStop(plannedStops, i, 1)}
                        ><Icon name="down" size={18} /></button
                      >
                    </div>{/if}
                </div>
              {/if}
            {/each}
          </div>
        {:else}
          <div class="card empty-state">
            <p class="empty-title">No stops yet</p>
            <p class="hint">
              Paste a plan in the Plan tab and its stops (with notes, discovery checklists and map
              pins) are extracted automatically with one tap — or add stops by name here.
            </p>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

{#if editingMoment}
  <MomentCapture
    {trip}
    {cities}
    {stops}
    moment={editingMoment}
    onClose={() => (editingMoment = null)}
  />
{/if}

{#if reviewingPlan && $stopsQ && $citiesQ}
  <PlanRevision
    {trip}
    {cities}
    stops={$stopsQ}
    initialText={trip.planText}
    onSaved={() => {}}
    onClose={() => (reviewingPlan = false)}
  />
{/if}

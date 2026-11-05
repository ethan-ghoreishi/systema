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
    cityIds,
  } from '../../lib/stops';
  import { addPhotos, deletePhoto, downloadPhoto, photoTime } from '../../lib/photos';
  import { instantToWall, wallToInstant, wallLabel } from '../../lib/tz';
  import { GONE, stopGroups, visitTimeline, zoneOf } from '../../lib/moments';
  import { hasPin, mapsLink } from '../../lib/maps';
  import { nasBackup } from '../../lib/nas.svelte';
  import PhotoPicker from '../PhotoPicker.svelte';
  import MomentCapture from '../MomentCapture.svelte';
  import { router, navigate } from '../../lib/router.svelte';
  import { recall, remember } from '../../lib/ui-memory';
  import Icon from '../Icon.svelte';
  import StopsMap from '../StopsMap.svelte';

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
  const moments = $derived($momentsQ ?? []);
  let editingMoment = $state<Moment | null>(null);
  const stops = $derived($stopsQ ?? []);
  const cities = $derived($citiesQ ?? []);
  const allPhotos = $derived($photosQ ?? []);
  const history = $derived(visitTimeline(stops, moments, cities));
  const visitNumber = $derived(
    new Map(
      history
        .filter((it) => it.kind === 'stop' && it.at != null)
        .map((it, i) => [it.kind === 'stop' ? it.stop.id : '', i + 1]),
    ),
  );
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
    const indexOf = new Map(stops.map((s, i) => [s.id, i]));
    const rows: StopRow[] = [];
    for (const group of stopGroups(stops, moments, cities)) {
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
    return instantToWall(m.at, zoneOf(m, cities)).slice(11, 16);
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
  let photoUrls = $state<Record<string, string>>({});
  $effect(() => {
    const map: Record<string, string> = {};
    for (const p of photos) map[p.id] = URL.createObjectURL(p.blob);
    photoUrls = map;
    return () => {
      for (const u of Object.values(map)) URL.revokeObjectURL(u);
    };
  });

  // Transient "Saved ✓" indicator shared by all autosaving fields here.
  let savedAt = $state<number | null>(null);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  function flashSaved() {
    savedAt = Date.now();
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (savedAt = null), 2000);
  }

  // ---- list ----
  let newStopName = $state('');
  async function addStopNow() {
    if (!newStopName.trim()) return;
    // A new stop is appended, so it joins the leg the list ends in — or the
    // first leg when there are no stops yet. Without legs it is unassigned.
    // The leg can be changed on the stop itself.
    const cityId = stops.length
      ? (stops[stops.length - 1].cityId ?? null)
      : (cities[0]?.id ?? null);
    await addStop(trip.id, newStopName, cityId);
    newStopName = '';
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
    if (!selected) return;
    const pos = { lat: Number(latDraft), lng: Number(lngDraft) };
    if (!latDraft.trim() || !lngDraft.trim() || !hasPin(pos)) {
      saveError = 'Enter latitude from −90 to 90 and longitude from −180 to 180.';
      return;
    }
    saveError = '';
    try {
      await placeStop(selected.id, pos);
      flashSaved();
    } catch (err) {
      failed(err);
    }
  }
  async function markVisited(s: Stop) {
    saveError = '';
    try {
      await toggleVisited(s);
    } catch (err) {
      failed(err);
    }
  }
  function failed(err: unknown) {
    savedAt = null;
    saveError = `Not saved: ${err instanceof Error ? err.message : String(err)}. Copy your text before leaving.`;
  }
  function saveName() {
    if (!selected) return;
    saveError = '';
    void updateStop(selected.id, { name: nameDraft.trim() || 'Untitled stop' })
      .then(flashSaved)
      .catch(failed);
  }

  function saveCity(cityId: string | null) {
    if (!selected) return;
    saveError = '';
    void updateStop(selected.id, { cityId }).then(flashSaved).catch(failed);
  }

  function saveNotes() {
    if (!selected) return;
    saveError = '';
    void updateStop(selected.id, { notes: notesDraft }).then(flashSaved).catch(failed);
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
  async function onPhotos(files: File[]) {
    if (!selected) return;
    const tz = zoneOf(selected, cities);
    await addPhotos(files, { tripId: trip.id, stopId: selected.id, kind: 'stop', tz });
    flashSaved();
  }

  /** On the NAS, waiting, or failed — so the backup state of each photo is plain. */
  function backupBadge(id: string): string {
    if (!nasBackup.configured) return '';
    if (nasBackup.failures[id]) return 'not backed up';
    return '';
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

{#if selected}
  {@const destination = mapsLink(selected, cities)}
  <!-- Detail -->
  <div class="stop-detail">
    <div class="detail-bar">
      <span class="autosave" class:autosave--on={savedAt}>
        {savedAt ? 'Saved ✓' : 'Saves automatically'}
      </span>
    </div>

    {#if saveError}<p role="alert" class="hint hint--warn">{saveError}</p>{/if}
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
        </form>
      {/if}
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
              if (selected)
                void placeStop(selected.id, null)
                  .then(() => {
                    latDraft = '';
                    lngDraft = '';
                    flashSaved();
                  })
                  .catch(failed);
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
            <option value={c.id}>{c.name || 'Unnamed leg'}</option>
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
        <div class="photo-grid">
          {#each photos as p (p.id)}
            <div class="photo-thumb">
              <img src={photoUrls[p.id]} alt={selected.name} loading="lazy" decoding="async" />
              {#if backupBadge(p.id)}<span class="photo-badge">{backupBadge(p.id)}</span>{/if}
              <div class="photo-actions">
                <button class="photo-act" aria-label="Save photo" onclick={() => downloadPhoto(p)}>
                  <Icon name="export" size={16} />
                </button>
                <button
                  class="photo-act"
                  aria-label="Delete photo"
                  onclick={() => {
                    if (
                      confirm(
                        'Delete this photo permanently from this device? Save and verify a separate copy first.',
                      )
                    )
                      void deletePhoto(p.id);
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
          {/each}
        </div>
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
      {:else if stopView === 'visited'}
        <p class="hint">
          Actual visit order. Markings use the time you tapped Visited; open a stop to correct a
          late marking. Moments stay with the visit they belong to.
        </p>
        <div class="stop-list visit-history">
          {#each history as it (it.kind === 'stop' ? it.stop.id : `m-${it.moment.id}`)}
            {#if it.kind === 'stop'}
              <button
                class="stop-row"
                onclick={() => openStop(it.stop)}
                use:focusReturn={returnFocus === it.stop.id}
              >
                <span class="stop-name"
                  >{visitNumber.has(it.stop.id) ? `${visitNumber.get(it.stop.id)}. ` : ''}{it.stop
                    .name}</span
                >
                <span class="stop-meta"
                  >{stamp(it.stop)}{cityNameById.get(it.stop.cityId ?? '')
                    ? ` · ${cityNameById.get(it.stop.cityId!)}`
                    : ''}</span
                >
              </button>
            {:else}
              <button class="stop-row moment-row" onclick={() => (editingMoment = it.moment)}>
                <span class="stop-name">{it.moment.title}</span>
                <span class="stop-meta"
                  >{it.moment.stopId && stopNameById.has(it.moment.stopId)
                    ? `at ${stopNameById.get(it.moment.stopId)}`
                    : 'off-plan'} · {wallLabel(
                    instantToWall(it.at, zoneOf(it.moment, cities)),
                  )}</span
                >
              </button>
            {/if}
          {:else}
            <p class="hint">
              No visits recorded yet. Mark a stop Visited, or use What happened? for a discovery off
              the plan.
            </p>
          {/each}
        </div>
        {#if stops.some((s) => s.visited && s.visitedAt == null)}<p class="hint">
            Older visits without a time appear at the end in planned order. Open one to add its
            visit time.
          </p>{/if}
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
        {#if extractable.length > 0}
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
          <button class="icon-btn" type="submit" aria-label="Add stop"><Icon name="plus" /></button>
        </form>

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
                        onclick={() => moveStop(stops, i, -1)}><Icon name="up" size={18} /></button
                      >
                      <button
                        class="icon-btn icon-btn--sm"
                        aria-label="Move down"
                        disabled={i === stops.length - 1}
                        onclick={() => moveStop(stops, i, 1)}><Icon name="down" size={18} /></button
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

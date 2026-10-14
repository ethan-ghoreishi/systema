<script lang="ts">
  import { untrack } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db, type Moment, type Stop, type StopGuide, type Trip } from '../../lib/db';
  import {
    addStop,
    updateStop,
    deleteStop,
    toggleVisited,
    moveStop,
    addChecklistItem,
    toggleChecklistItem,
    deleteChecklistItem,
    checklistProgress,
    importStopsFromPlan,
    newStopCandidates,
  } from '../../lib/stops';
  import { addPhotos, deletePhoto, downloadPhoto, photoTime } from '../../lib/photos';
  import { instantToWall } from '../../lib/tz';
  import { nasBackup } from '../../lib/nas.svelte';
  import PhotoPicker from '../PhotoPicker.svelte';
  import MomentCapture from '../MomentCapture.svelte';
  import { router, navigate } from '../../lib/router.svelte';
  import { recall, remember } from '../../lib/ui-memory';
  import Icon from '../Icon.svelte';
  import StopsMap from '../StopsMap.svelte';

  let { trip }: { trip: Trip } = $props();

  // 'list' | 'map', kept per trip — the map redraws live as stops change.
  const viewKey = untrack(() => `stops:${trip.id}:view`);
  let stopView = $state<'list' | 'map'>(recall(viewKey, 'list'));
  $effect(() => remember(viewKey, stopView));

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

  // Multi-city trips group their stops under city sub-headers.
  const multiCity = $derived(cities.length >= 2);
  const cityNameById = $derived(new Map(cities.map((c) => [c.id, c.name])));

  type StopRow =
    | { kind: 'header'; label: string }
    | { kind: 'stop'; stop: Stop; index: number }
    | { kind: 'moment'; moment: Moment };
  /** Planned stops grouped by city, each city's off-plan moments after its stops. */
  const stopRows = $derived.by<StopRow[]>(() => {
    const momentsFor = (key: string | null) =>
      moments
        .filter(
          (m) => (m.cityId ?? null) === key || (key === null && !cityNameById.has(m.cityId ?? '')),
        )
        .map((moment) => ({ kind: 'moment' as const, moment }));
    if (!multiCity) {
      const rows: StopRow[] = stops.map((stop, index) => ({ kind: 'stop', stop, index }));
      if (moments.length)
        rows.push(
          { kind: 'header', label: 'Off the plan' },
          ...moments.map((moment) => ({ kind: 'moment' as const, moment })),
        );
      return rows;
    }
    const rows: StopRow[] = [];
    let lastKey: string | null | undefined = undefined;
    const closeGroup = () => {
      if (lastKey !== undefined) rows.push(...momentsFor(lastKey));
    };
    stops.forEach((stop, index) => {
      const key = stop.cityId && cityNameById.has(stop.cityId) ? stop.cityId : null;
      if (key !== lastKey) {
        closeGroup();
        rows.push({ kind: 'header', label: (key && cityNameById.get(key)) || 'Other' });
        lastKey = key;
      }
      rows.push({ kind: 'stop', stop, index });
    });
    closeGroup();
    // Cities with moments but no stops yet.
    const shownKeys = new Set(
      stops.map((s) => (s.cityId && cityNameById.has(s.cityId) ? s.cityId : null)),
    );
    for (const c of cities)
      if (!shownKeys.has(c.id) && moments.some((m) => m.cityId === c.id))
        rows.push({ kind: 'header', label: c.name }, ...momentsFor(c.id));
    return rows;
  });

  function momentTime(m: Moment): string {
    const tz = cities.find((c) => c.id === m.cityId)?.tz;
    return instantToWall(m.at, tz).slice(11, 16);
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
    await addStop(trip.id, newStopName);
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
  $effect(() => {
    if (selected && draftsFor !== selected.id) {
      editingGuide = false;
      nameDraft = selected.name;
      notesDraft = selected.notes;
      draftsFor = selected.id;
    }
  });

  let saveError = $state('');
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
    const tz = cities.find((c) => c.id === selected.cityId)?.tz;
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
    if (selected && confirm(`Delete stop “${selected.name}”? Its photos go with it.`)) {
      const id = selected.id;
      backToList();
      await deleteStop(id);
    }
  }
</script>

{#if selected}
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

    <label class="switch">
      <input type="checkbox" checked={selected.visited} onchange={() => toggleVisited(selected)} />
      <span>Visited</span>
    </label>

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
    {#if stops.length > 0}
      <div class="segmented stops-toggle" role="tablist" aria-label="List or map">
        <button
          class="segment"
          class:segment--on={stopView === 'list'}
          role="tab"
          aria-selected={stopView === 'list'}
          onclick={() => (stopView = 'list')}>List</button
        >
        <button
          class="segment"
          class:segment--on={stopView === 'map'}
          role="tab"
          aria-selected={stopView === 'map'}
          onclick={() => (stopView = 'map')}>Map</button
        >
      </div>
    {/if}

    {#if stopView === 'map' && stops.length > 0}
      <StopsMap {stops} {cities} onOpen={openStop} memoryKey={`stops:${trip.id}:map-city`} />
    {:else}
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

      {#if stops.length}
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
                    >off-plan · {momentTime(m)}{n ? ` · ${n} photo${n > 1 ? 's' : ''}` : ''}</span
                  >
                </button>
              </div>
            {:else}
              {@const s = row.stop}
              {@const i = row.index}
              {@const p = checklistProgress(s)}
              <div class="stop-row" class:stop-row--visited={s.visited}>
                <button
                  class="check-box"
                  aria-label={s.visited ? 'Mark not visited' : 'Mark visited'}
                  onclick={() => toggleVisited(s)}
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
                <div class="stop-reorder">
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
                </div>
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

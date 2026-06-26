<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type Stop, type Trip } from '../../lib/db';
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
    splitPlanIntoStops,
    splittableHeadingCount,
  } from '../../lib/stops';
  import { addPhoto, deletePhoto, downloadPhoto } from '../../lib/photos';
  import { router, navigate } from '../../lib/router.svelte';
  import Icon from '../Icon.svelte';

  let { trip }: { trip: Trip } = $props();

  const stopsQ = liveQuery(() => db.stops.where('tripId').equals(trip.id).sortBy('order'));
  const photosQ = liveQuery(() => db.photos.where('tripId').equals(trip.id).toArray());
  const stops = $derived($stopsQ ?? []);
  const allPhotos = $derived($photosQ ?? []);

  // Detail selection via the route: #/trip/:id/stops/:stopId
  const selectedId = $derived(router.path.split('/').filter(Boolean)[3] ?? null);
  const selected = $derived(selectedId ? (stops.find((s) => s.id === selectedId) ?? null) : null);

  const headingCount = $derived(splittableHeadingCount(trip.planText));

  const photoCounts = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const p of allPhotos) if (p.stopId) m[p.stopId] = (m[p.stopId] ?? 0) + 1;
    return m;
  });

  const photos = $derived(allPhotos.filter((p) => p.stopId === selectedId));
  let photoUrls = $state<Record<string, string>>({});
  $effect(() => {
    const map: Record<string, string> = {};
    for (const p of photos) map[p.id] = URL.createObjectURL(p.blob);
    photoUrls = map;
    return () => {
      for (const u of Object.values(map)) URL.revokeObjectURL(u);
    };
  });

  // ---- list ----
  let newStopName = $state('');
  async function addStopNow() {
    if (!newStopName.trim()) return;
    await addStop(trip.id, newStopName);
    newStopName = '';
  }
  function openStop(s: Stop) {
    navigate(`/trip/${trip.id}/stops/${s.id}`);
  }
  function backToList() {
    navigate(`/trip/${trip.id}/stops`);
  }

  // ---- detail: notes (load once per stop, debounced save) ----
  let notesDraft = $state('');
  let notesFor = $state<string | null>(null);
  $effect(() => {
    if (selected && notesFor !== selected.id) {
      notesDraft = selected.notes;
      notesFor = selected.id;
    }
  });
  let notesTimer: ReturnType<typeof setTimeout> | null = null;
  function saveNotes() {
    if (!selected) return;
    const id = selected.id;
    if (notesTimer) clearTimeout(notesTimer);
    notesTimer = setTimeout(() => void updateStop(id, { notes: notesDraft }), 400);
  }

  // ---- detail: photos + checklist ----
  async function onPhoto(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file && selected)
      await addPhoto(file, { tripId: trip.id, stopId: selected.id, kind: 'stop' });
    input.value = '';
  }

  let newItemText = $state('');
  async function addItem() {
    if (!selected) return;
    await addChecklistItem(selected, newItemText);
    newItemText = '';
  }

  async function removeStop() {
    if (selected && confirm(`Delete stop “${selected.name}”?`)) {
      const id = selected.id;
      backToList();
      await deleteStop(id);
    }
  }
</script>

{#if selected}
  <!-- Detail -->
  <div class="stop-detail">
    <button class="btn btn--ghost btn--sm back-link" onclick={backToList}>
      <Icon name="back" size={18} /> Stops
    </button>

    <input
      class="field stop-name-input"
      aria-label="Stop name"
      value={selected.name}
      onchange={(e) =>
        updateStop(selected.id, { name: (e.currentTarget as HTMLInputElement).value })}
    />

    <label class="switch">
      <input type="checkbox" checked={selected.visited} onchange={() => toggleVisited(selected)} />
      <span>Visited</span>
    </label>

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
              <img src={photoUrls[p.id]} alt={selected.name} />
              <div class="photo-actions">
                <button class="photo-act" aria-label="Save photo" onclick={() => downloadPhoto(p)}>
                  <Icon name="export" size={16} />
                </button>
                <button
                  class="photo-act"
                  aria-label="Delete photo"
                  onclick={() => deletePhoto(p.id)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      <label class="btn btn--ghost receipt-btn">
        <Icon name="camera" size={20} /> Add photo
        <input type="file" accept="image/*" capture="environment" hidden onchange={onPhoto} />
      </label>
      <p class="hint">Stored on this device. Save photos off-device, then delete, to free space.</p>
    </div>

    <button class="btn btn--danger" onclick={removeStop}>Delete stop</button>
  </div>
{:else}
  <!-- List -->
  <div class="stops">
    {#if headingCount > 0 && stops.length === 0}
      <button class="btn btn--ghost" onclick={() => splitPlanIntoStops(trip.id, trip.planText)}>
        Split plan into {headingCount} stops by heading
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
        {#each stops as s, i (s.id)}
          {@const p = checklistProgress(s)}
          <div class="stop-row" class:stop-row--visited={s.visited}>
            <button
              class="check-box"
              aria-label={s.visited ? 'Mark not visited' : 'Mark visited'}
              onclick={() => toggleVisited(s)}
            >
              {#if s.visited}<Icon name="check" size={16} />{/if}
            </button>
            <button class="stop-open" onclick={() => openStop(s)}>
              <span class="stop-name">{s.name}</span>
              <span class="stop-meta">
                {#if p.total}{p.done}/{p.total} ticked{/if}
                {#if photoCounts[s.id]}{p.total ? ' · ' : ''}{photoCounts[s.id]} photo{photoCounts[
                    s.id
                  ] > 1
                    ? 's'
                    : ''}{/if}
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
        {/each}
      </div>
    {:else}
      <div class="card empty-state">
        <p class="empty-title">No stops yet</p>
        <p class="hint">
          Add stops by name, or paste a plan in the Plan tab and split it by headings. Open a stop
          to add notes, a checklist and photos.
        </p>
      </div>
    {/if}
  </div>
{/if}

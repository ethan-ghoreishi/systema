<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { City, Moment, Stop, Trip } from '../lib/db';
  import { addMoment, deleteMoment, updateMoment } from '../lib/moments';
  import { addPhotos } from '../lib/photos';
  import { activeLegId } from '../lib/trip-shape';
  import { instantToWall, wallToInstant } from '../lib/tz';
  import PhotoPicker from './PhotoPicker.svelte';

  /**
   * "What happened?" — a few seconds to keep something that wasn't in the
   * plan: a place found by accident, a changed plan, a missed train, an
   * encounter. The city and the time fill themselves in; only a name is
   * needed. Photos from the camera or the library come with it.
   */
  let {
    trip,
    cities,
    stops,
    moment = null,
    onClose,
  }: {
    trip: Trip;
    cities: City[];
    stops: Stop[];
    moment?: Moment | null;
    onClose: () => void;
  } = $props();

  let dialogEl: HTMLDialogElement;
  let titleEl: HTMLInputElement;
  onMount(() => {
    dialogEl.showModal();
    if (!moment) titleEl.focus();
  });

  const init = untrack(() => ({
    cityId: moment ? moment.cityId : (activeLegId(cities) ?? null),
    title: moment?.title ?? '',
    note: moment?.note ?? '',
    stopId: moment?.stopId ?? null,
    at: moment?.at ?? Date.now(),
  }));
  let cityId = $state<string | null>(init.cityId);
  let title = $state(init.title);
  let note = $state(init.note);
  let stopId = $state<string | null>(init.stopId);
  let at = $state(init.at);
  let editingTime = $state(false);
  let files = $state<File[]>([]);
  let saving = $state(false);
  let error = $state('');

  const tz = $derived(cities.find((c) => c.id === cityId)?.tz);
  const wall = $derived(instantToWall(at, tz));
  const cityStops = $derived(stops.filter((s) => !cityId || s.cityId === cityId));

  async function save() {
    if (!title.trim()) return;
    saving = true;
    error = '';
    try {
      let id = moment?.id;
      const fields = { cityId, title: title.trim(), note: note.trim(), stopId, at };
      if (id) await updateMoment(id, fields);
      else id = await addMoment({ tripId: trip.id, ...fields });
      if (files.length)
        await addPhotos(files, { tripId: trip.id, kind: 'stop', stopId, momentId: id, tz });
      dialogEl.close();
    } catch (err) {
      error = `Not saved: ${err instanceof Error ? err.message : String(err)}. Your entry is still here.`;
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!moment) return;
    if (confirm(`Delete “${moment.title}” and its photos?`)) {
      await deleteMoment(moment.id);
      dialogEl.close();
    }
  }
</script>

<dialog
  class="modal"
  bind:this={dialogEl}
  onclose={onClose}
  oncancel={(e) => {
    if (saving) e.preventDefault();
  }}
>
  <div class="modal-sheet">
    <header class="modal-head">
      <button class="btn btn--ghost btn--sm" onclick={() => dialogEl.close()} disabled={saving}
        >Cancel</button
      >
      <h2 class="modal-title">{moment ? 'Moment' : 'What happened?'}</h2>
      <button class="btn btn--primary btn--sm" onclick={save} disabled={saving || !title.trim()}
        >Save</button
      >
    </header>
    <div class="modal-body">
      {#if error}<p role="alert" class="hint hint--warn">{error}</p>{/if}

      {#if cities.length > 1}
        <div class="chips" role="group" aria-label="City">
          {#each cities as c (c.id)}
            <button class="chip" class:chip--on={cityId === c.id} onclick={() => (cityId = c.id)}
              >{c.name}</button
            >
          {/each}
        </div>
      {/if}

      <input
        bind:this={titleEl}
        class="field"
        aria-label="Place or event"
        placeholder="A courtyard concert, a missed bus, a conversation…"
        bind:value={title}
      />

      <div class="moment-when">
        <span class="hint">{moment ? 'At' : 'Now'} · {wall.slice(11, 16)}</span>
        <button class="link-btn" onclick={() => (editingTime = !editingTime)}>change</button>
      </div>
      {#if editingTime}
        <input
          class="field"
          type="datetime-local"
          aria-label="When"
          value={wall}
          onchange={(e) => {
            const t = wallToInstant((e.currentTarget as HTMLInputElement).value, tz);
            if (t != null) at = t;
          }}
        />
      {/if}

      <textarea
        class="field"
        rows="2"
        aria-label="Why it mattered"
        placeholder="Why it mattered (optional)"
        bind:value={note}></textarea>

      <div>
        <label class="label" for="moment-stop">Part of a planned stop?</label>
        <select id="moment-stop" class="field" bind:value={stopId}>
          <option value={null}>No — off the plan</option>
          {#each cityStops as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </div>

      <PhotoPicker onFiles={(f) => (files = [...files, ...f])} disabled={saving} />
      {#if files.length}
        <p class="hint">{files.length} photo{files.length > 1 ? 's' : ''} to add.</p>
      {/if}

      {#if moment}
        <button class="btn btn--danger" onclick={remove}>Delete moment</button>
      {/if}
    </div>
  </div>
</dialog>

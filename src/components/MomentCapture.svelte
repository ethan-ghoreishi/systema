<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { City, Moment, Stop, Trip } from '../lib/db';
  import {
    addMoment,
    alignToStop,
    deleteMoment,
    updateMoment,
    zoneOf,
    retrospective,
    momentWhen,
  } from '../lib/moments';
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { preparePhotos, photoTime } from '../lib/photos';
  import { hasPin } from '../lib/maps';
  import PhotoGallery from './PhotoGallery.svelte';
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
    precision: moment
      ? (moment.timePrecision ?? 'exact')
      : retrospective(trip, cities)
        ? 'unknown'
        : 'exact',
  }));
  let cityId = $state<string | null>(init.cityId);
  let title = $state(init.title);
  let note = $state(init.note);
  let stopId = $state<string | null>(init.stopId);
  let at = $state(init.at);
  let precision = $state<Moment['timePrecision'] | 'exact'>(
    init.precision as Moment['timePrecision'] | 'exact',
  );
  let timeDraft = $state('');
  let dateDraft = $state('');
  let editingTime = $state(false);
  let files = $state<File[]>([]);
  let savedId = $state<string | undefined>(untrack(() => moment?.id));
  let saving = $state(false);
  let error = $state('');
  const photosQ = liveQuery(() =>
    moment ? db.photos.where('momentId').equals(moment.id).toArray() : [],
  );
  const photos = $derived([...($photosQ ?? [])].sort((a, b) => photoTime(a) - photoTime(b)));
  let latDraft = $state(untrack(() => moment?.lat?.toString() ?? ''));
  let lngDraft = $state(untrack(() => moment?.lng?.toString() ?? ''));
  const validLocation = $derived(
    !!stopId ||
      (!latDraft.trim() && !lngDraft.trim()) ||
      (!!latDraft.trim() &&
        !!lngDraft.trim() &&
        hasPin({ lat: Number(latDraft), lng: Number(lngDraft) })),
  );
  const original = untrack(() => (moment ? $state.snapshot(moment) : null));

  // The zone this moment's time is read in: its leg's, the one kept on the
  // record when that leg was deleted, or — once it is part of a stop — the
  // stop's, by the same rule the save applies. So the time shown here, the
  // time typed here and the time listed are one time.
  const tz = $derived.by(() => {
    const place = { cityId, tz: moment?.tz, legName: moment?.legName };
    alignToStop(
      place,
      stops.find((s) => s.id === stopId),
    );
    return zoneOf(place, cities);
  });
  const wall = $derived(instantToWall(at, tz));
  const dateOnly = $derived(precision === 'date' || precision === 'approximate');
  const enteredWall = $derived(dateOnly ? `${dateDraft}T12:00` : timeDraft.slice(0, 16));
  const enteredAt = $derived(wallToInstant(enteredWall, tz));
  const validTime = $derived(
    !editingTime ||
      precision === 'unknown' ||
      (enteredAt != null && instantToWall(enteredAt, tz) === enteredWall),
  );
  const timeLabel = $derived(
    editingTime && precision !== 'unknown' && !validTime
      ? 'Choose when it happened'
      : momentWhen(
          {
            at: editingTime ? (enteredAt ?? at) : at,
            timePrecision: precision === 'exact' ? undefined : precision,
            cityId,
            tz,
          },
          cities,
        ),
  );
  // The stops that can be part of this leg: its own, and the ones that are on
  // no leg at all — those belong wherever the moment does.
  const onLeg = (s: Stop) => !cityId || !s.cityId || s.cityId === cityId;
  const cityStops = $derived(stops.filter(onLeg));

  // The two controls can't be left disagreeing: picking a stop that is on a
  // leg moves the leg with it, and picking a leg that its stop is not on lets
  // go of that stop, in plain sight — the same rule the saved record keeps.
  function keepDate(nextCity: string | null, nextStop: string | null) {
    if (!dateOnly) return true;
    const place = { cityId: nextCity, tz: moment?.tz, legName: moment?.legName };
    alignToStop(
      place,
      stops.find((s) => s.id === nextStop),
    );
    const date = editingTime ? dateDraft : wall.slice(0, 10);
    const nextAt = wallToInstant(`${date}T12:00`, zoneOf(place, cities));
    if (!date) return true;
    if (nextAt == null || instantToWall(nextAt, zoneOf(place, cities)).slice(0, 10) !== date) {
      error = 'This calendar date does not exist in the chosen city. Correct the date first.';
      return false;
    }
    at = nextAt;
    return true;
  }
  function choosePrecision(next: typeof precision) {
    if (next === 'exact' && precision !== 'exact') timeDraft = '';
    if ((next === 'date' || next === 'approximate') && precision === 'exact' && timeDraft)
      dateDraft = timeDraft.slice(0, 10);
    if (next === 'unknown') {
      timeDraft = '';
      dateDraft = '';
    }
    precision = next;
  }
  function chooseStop(id: string | null) {
    const next = stops.find((s) => s.id === id);
    if (!keepDate(next?.cityId ?? cityId, id)) return;
    stopId = id;
    const s = stops.find((x) => x.id === id);
    if (s?.cityId) cityId = s.cityId;
  }
  function chooseCity(id: string) {
    if (!keepDate(id, null)) return;
    cityId = id;
    if (stopId && !stops.some((s) => s.id === stopId && (!s.cityId || s.cityId === id)))
      stopId = null;
  }

  async function save() {
    if (!title.trim() || !validTime || !validLocation || saving) return;
    saving = true;
    error = '';
    try {
      const fields = {
        cityId,
        title: title.trim(),
        note: note.trim(),
        stopId,
        at: editingTime && precision !== 'unknown' ? enteredAt! : at,
        timePrecision: precision === 'exact' ? undefined : precision,
        lat: !stopId && latDraft.trim() ? Number(latDraft) : undefined,
        lng: !stopId && lngDraft.trim() ? Number(lngDraft) : undefined,
      };
      const addedPhotos = await preparePhotos(files, { tripId: trip.id, kind: 'stop', stopId, tz });
      let writtenId: string | undefined;
      await db.transaction('rw', db.moments, db.photos, db.stops, db.cities, async () => {
        if (savedId) await updateMoment(savedId, fields, original ?? undefined);
        else writtenId = await addMoment({ tripId: trip.id, ...fields });
        if (addedPhotos.length)
          await db.photos.bulkAdd(
            addedPhotos.map((p) => ({ ...p, momentId: savedId ?? writtenId! })),
          );
      });
      savedId = savedId ?? writtenId;
      files = [];
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
      saving = true;
      error = '';
      try {
        await deleteMoment(moment.id);
        dialogEl.close();
      } catch (err) {
        error = `Not deleted: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        saving = false;
      }
    }
  }
</script>

<dialog
  class="modal"
  aria-labelledby="moment-title"
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
      <h2 class="modal-title" id="moment-title">{moment ? 'Moment' : 'What happened?'}</h2>
      <button
        class="btn btn--primary btn--sm"
        onclick={save}
        disabled={saving || !title.trim() || !validTime || !validLocation}>Save</button
      >
    </header>
    <div class="modal-body">
      {#if error}<p role="alert" class="hint hint--warn">{error}</p>{/if}

      {#if cities.length > 0}
        <div class="chips" role="group" aria-label="City">
          {#each cities as c (c.id)}
            <button class="chip" class:chip--on={cityId === c.id} onclick={() => chooseCity(c.id)}
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
        <span class="hint"
          >{!moment && !editingTime && precision === 'exact'
            ? `Now · ${wall.slice(11, 16)}`
            : timeLabel}</span
        >
        <button
          class="link-btn"
          onclick={() => {
            if (!editingTime && precision !== 'unknown') {
              dateDraft = wall.slice(0, 10);
              timeDraft = dateOnly ? '' : wall;
            }
            editingTime = true;
          }}>change</button
        >
      </div>
      {#if original && precision === 'exact' && wall.slice(0, 10) !== instantToWall(original.at, zoneOf(original, cities)).slice(0, 10)}
        <p class="hint hint--warn">
          The exact instant is kept. In this city's time zone it falls on {wall.slice(0, 10)}. Use
          “change” to correct the event time.
        </p>
      {/if}
      {#if editingTime}
        <label class="label" for="moment-precision">When did it happen?</label>
        <select
          id="moment-precision"
          class="field"
          value={precision}
          onchange={(e) => choosePrecision(e.currentTarget.value as typeof precision)}
        >
          <option value="exact">Exact date and time</option>
          <option value="date">Date only</option>
          <option value="approximate">Approximate date</option>
          <option value="unknown">Not sure when</option>
        </select>
        {#if precision !== 'unknown'}
          <label class="label" for="moment-when">When · {tz ?? 'device local time'}</label>
          {#if dateOnly}
            <input
              id="moment-when"
              class="field"
              type="date"
              aria-label="When"
              bind:value={dateDraft}
            />
          {:else}
            <input
              id="moment-when"
              class="field"
              type="datetime-local"
              aria-label="When"
              bind:value={timeDraft}
            />
            {#if !timeDraft && dateDraft}<p class="hint">
                Known date: {dateDraft}. Enter the actual clock time to make this exact.
              </p>{/if}
          {/if}
          {#if !validTime}<p class="hint hint--warn" role="alert">
              Enter a valid local {dateOnly ? 'date' : 'date and time'}. Check for a clock change.
            </p>{/if}
        {/if}
        <p class="hint">
          Unknown means no event date is assumed. For an approximate date, explain what you remember
          in the note.
        </p>
      {/if}

      <textarea
        class="field"
        rows="2"
        aria-label="Why it mattered"
        placeholder="Why it mattered (optional)"
        bind:value={note}></textarea>

      <div>
        <label class="label" for="moment-stop">Part of a planned stop?</label>
        <select
          id="moment-stop"
          class="field"
          value={stopId ?? ''}
          onchange={(e) => chooseStop((e.currentTarget as HTMLSelectElement).value || null)}
        >
          <option value="">No — off the plan</option>
          {#each cityStops as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </div>

      {#if !stopId}
        <details open={!!moment && (moment.lat != null || moment.lng != null)}>
          <summary>Map location (optional)</summary>
          <p class="hint">
            Add coordinates here, or save and open Stops → Map. Choose this Moment under “Not on the
            map yet”, then tap its location. The map works with cached tiles offline.
          </p>
          <label class="label" for="moment-lat">Latitude</label>
          <input id="moment-lat" class="field" inputmode="decimal" bind:value={latDraft} />
          <label class="label" for="moment-lng">Longitude</label>
          <input id="moment-lng" class="field" inputmode="decimal" bind:value={lngDraft} />
          {#if !validLocation}<p class="hint hint--warn" role="alert">
              Enter both latitude (−90 to 90) and longitude (−180 to 180), or leave both blank.
            </p>{/if}
        </details>
      {:else}<p class="hint">Uses the linked Stop's map location.</p>{/if}

      {#if photos.length}
        <span class="label">Saved photos</span>
        <PhotoGallery {photos} label={moment?.title ?? title} disabled={saving} />
      {/if}
      <PhotoPicker onFiles={(f) => (files = [...files, ...f])} disabled={saving} />
      {#if files.length}
        <p class="hint">{files.length} photo{files.length > 1 ? 's' : ''} to add.</p>
      {/if}

      {#if moment}
        <button class="btn btn--danger" disabled={saving} onclick={remove}>Delete moment</button>
      {/if}
    </div>
  </div>
</dialog>

<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type CoverMode, type Trip } from '../lib/db';
  import { newId } from '../lib/ids';
  import { updateTrip } from '../lib/trips';
  import TripCover from './TripCover.svelte';

  /** Choose how a trip's cover is drawn, and pin/upload a photo for it. */
  let { trip }: { trip: Trip } = $props();

  const photosQ = liveQuery(() =>
    db.photos
      .where('tripId')
      .equals(trip.id)
      .and((p) => p.kind === 'stop' || p.kind === 'cover')
      .toArray(),
  );
  const photos = $derived($photosQ ?? []);

  const modes: { v: CoverMode; label: string }[] = [
    { v: 'auto', label: 'Auto' },
    { v: 'map', label: 'Route map' },
    { v: 'route-card', label: 'Route card' },
    { v: 'photo', label: 'Photo' },
  ];
  const mode = $derived(trip.coverMode ?? 'auto');

  // Thumbnails for the photo picker.
  let urls = $state<Record<string, string>>({});
  $effect(() => {
    const map: Record<string, string> = {};
    for (const p of photos) map[p.id] = URL.createObjectURL(p.blob);
    urls = map;
    return () => {
      for (const u of Object.values(map)) URL.revokeObjectURL(u);
    };
  });

  function setMode(v: CoverMode) {
    void updateTrip(trip.id, { coverMode: v });
  }

  function pickPhoto(photoId: string) {
    void updateTrip(trip.id, { coverMode: 'photo', coverPhotoId: photoId });
  }

  async function onUpload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const photoId = newId();
    await db.photos.add({
      id: photoId,
      tripId: trip.id,
      stopId: null,
      expenseId: null,
      kind: 'cover',
      blob: file,
      createdAt: Date.now(),
    });
    await updateTrip(trip.id, { coverMode: 'photo', coverPhotoId: photoId });
  }
</script>

<div class="card">
  <h2 class="section-title">Cover</h2>
  <TripCover {trip} size="cover" />

  <div class="chips">
    {#each modes as m (m.v)}
      <button class="chip" class:chip--on={mode === m.v} onclick={() => setMode(m.v)}
        >{m.label}</button
      >
    {/each}
  </div>

  {#if mode === 'photo'}
    {#if photos.length}
      <div class="cover-grid">
        {#each photos as p (p.id)}
          <button
            class="cover-thumb"
            class:cover-thumb--on={trip.coverPhotoId === p.id}
            aria-label="Use this photo as the cover"
            onclick={() => pickPhoto(p.id)}
          >
            <img src={urls[p.id]} alt="" loading="lazy" />
          </button>
        {/each}
      </div>
    {:else}
      <p class="hint">No photos on this trip yet — upload one below.</p>
    {/if}
    <label class="btn btn--ghost">
      Upload a cover photo
      <input type="file" accept="image/*" hidden onchange={onUpload} />
    </label>
  {/if}
</div>

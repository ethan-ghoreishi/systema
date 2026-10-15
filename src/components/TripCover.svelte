<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type Trip } from '../lib/db';
  import { routeSketchSvg, routeRibbonSvg, type CoverPoint } from '../lib/cover';
  import { isMultiCity, journeyRhythm, shortDateSpan } from '../lib/trip-shape';

  /**
   * A trip's cover. `auto`: a single city shows its route sketch (stop
   * coordinates at city scale), then a photo, then an abstract ribbon. A
   * multi-city trip's route spans countries — a sketch of it says nothing — so
   * its auto cover is a photo, else a journey card: the cities in order, the
   * dates and the rhythm. The broad map stays available as an explicit
   * "Route overview". The trip can force any mode and pin a photo.
   */
  let { trip, size = 'thumb' }: { trip: Trip; size?: 'thumb' | 'cover' } = $props();

  const stopsQ = liveQuery(() => db.stops.where('tripId').equals(trip.id).sortBy('order'));
  const citiesQ = liveQuery(() => db.cities.where('tripId').equals(trip.id).sortBy('order'));
  const stops = $derived($stopsQ ?? []);
  const cities = $derived($citiesQ ?? []);
  const multi = $derived(isMultiCity(cities));
  const points = $derived<CoverPoint[]>(
    stops
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ lat: s.lat as number, lng: s.lng as number, visited: s.visited })),
  );

  const mode = $derived(trip.coverMode ?? 'auto');
  const wantPhoto = $derived(
    mode === 'photo' || (mode === 'auto' && (multi || points.length === 0)),
  );

  let photoUrl = $state<string | null>(null);
  $effect(() => {
    if (!wantPhoto) {
      photoUrl = null;
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    void (async () => {
      let photo = trip.coverPhotoId ? await db.photos.get(trip.coverPhotoId) : undefined;
      if (!photo)
        photo = await db.photos
          .where('tripId')
          .equals(trip.id)
          .and((p) => p.kind === 'cover' || p.kind === 'stop')
          .first();
      if (cancelled) return;
      if (photo) {
        url = URL.createObjectURL(photo.blob);
        photoUrl = url;
      } else {
        photoUrl = null;
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  });

  // What to draw when there's no photo.
  const kind = $derived.by((): 'sketch' | 'journey' | 'ribbon' => {
    if (mode === 'map' && points.length) return 'sketch';
    if (mode === 'route-card') return multi ? 'journey' : 'ribbon';
    if (multi) return 'journey';
    return points.length && mode !== 'photo' ? 'sketch' : 'ribbon';
  });
  const svg = $derived(kind === 'sketch' ? routeSketchSvg(points) : routeRibbonSvg(trip.id));
  const rhythm = $derived(journeyRhythm(cities));
  const span = $derived(shortDateSpan(trip, cities));
</script>

<div class="trip-cover trip-cover--{size}" data-cover={photoUrl ? 'photo' : kind}>
  {#if photoUrl}
    <img src={photoUrl} alt="" loading="lazy" />
  {:else if kind === 'journey'}
    <div class="journey-card" aria-label="Journey">
      {#if size === 'thumb'}
        <span class="journey-short"
          >{rhythm.map((r) => r.name.slice(0, 3).toUpperCase()).join('·')}</span
        >
      {:else}
        <span class="journey-cities">{rhythm.map((r) => r.name).join(' → ')}</span>
        {#if span}<span class="journey-dates">{span}</span>{/if}
        <span class="journey-rhythm">{rhythm.map((r) => `${r.name}, ${r.part}`).join(' → ')}</span>
      {/if}
    </div>
  {:else}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- app-generated SVG, no user input -->
    {@html svg}
  {/if}
</div>

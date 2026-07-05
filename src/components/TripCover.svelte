<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type Trip } from '../lib/db';
  import { routeSketchSvg, routeRibbonSvg, type CoverPoint } from '../lib/cover';

  /**
   * A trip's cover. `auto` prefers the route map (a sketch plotted from stop
   * coordinates), then a photo, then an abstract route ribbon — but the trip can
   * force any of them (coverMode) and pin a specific photo (coverPhotoId).
   */
  let { trip, size = 'thumb' }: { trip: Trip; size?: 'thumb' | 'cover' } = $props();

  const stopsQ = liveQuery(() => db.stops.where('tripId').equals(trip.id).sortBy('order'));
  const stops = $derived($stopsQ ?? []);
  const points = $derived<CoverPoint[]>(
    stops
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ lat: s.lat as number, lng: s.lng as number, visited: s.visited })),
  );

  const mode = $derived(trip.coverMode ?? 'auto');
  const wantPhoto = $derived(mode === 'photo' || (mode === 'auto' && points.length === 0));

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

  const svg = $derived.by(() => {
    if (mode === 'route-card') return routeRibbonSvg(trip.id);
    if (points.length && mode !== 'photo') return routeSketchSvg(points);
    return routeRibbonSvg(trip.id);
  });
</script>

<div class="trip-cover trip-cover--{size}">
  {#if photoUrl}
    <img src={photoUrl} alt="" loading="lazy" />
  {:else}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- app-generated SVG, no user input -->
    {@html svg}
  {/if}
</div>

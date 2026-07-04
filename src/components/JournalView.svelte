<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type Photo, type Trip } from '../lib/db';
  import { renderPlan } from '../lib/markdown';
  import { splitJournal, assignPhotos } from '../lib/journal';
  import { realExpenses, tripTotalGBP } from '../lib/expenses';
  import { formatGBP } from '../lib/money';
  import { formatDateRange } from '../lib/format';
  import StopsMap from './StopsMap.svelte';

  /**
   * The trip journal, rendered as a piece: a stats header, the journal prose
   * with `[photo: …]` placeholders swapped for the real photographs, and a
   * gallery of everything not woven into the text.
   */
  let { trip }: { trip: Trip } = $props();

  const stopsQ = liveQuery(() => db.stops.where('tripId').equals(trip.id).sortBy('order'));
  const photosQ = liveQuery(() => db.photos.where('tripId').equals(trip.id).toArray());
  const expensesQ = liveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray());
  const stops = $derived($stopsQ ?? []);
  const photos = $derived(($photosQ ?? []).filter((p) => p.kind === 'stop'));
  const expenses = $derived($expensesQ ?? []);

  const visitedCount = $derived(stops.filter((s) => s.visited).length);
  const total = $derived(tripTotalGBP(realExpenses(expenses)));

  const segments = $derived(splitJournal(trip.journalText ?? ''));

  const stopNameById = $derived(
    Object.fromEntries(stops.map((s) => [s.id, s.name])) as Record<string, string>,
  );

  const assignment = $derived.by(() => {
    const byName: Record<string, Photo[]> = {};
    for (const p of photos) {
      const name = p.stopId ? (stopNameById[p.stopId] ?? '') : '';
      if (!name) continue;
      (byName[name] ??= []).push(p);
    }
    return assignPhotos(segments, byName);
  });

  // Object URLs for every photo shown; revoked when the set changes.
  let urls = $state<Record<string, string>>({});
  $effect(() => {
    const map: Record<string, string> = {};
    for (const p of photos) map[p.id] = URL.createObjectURL(p.blob);
    urls = map;
    return () => {
      for (const u of Object.values(map)) URL.revokeObjectURL(u);
    };
  });

  function captionFor(p: Photo): string {
    return p.stopId ? (stopNameById[p.stopId] ?? '') : '';
  }

  const mappedStops = $derived(stops.filter((s) => s.lat != null && s.lng != null));
</script>

<div class="journal">
  <div class="card journal-meta">
    <span class="journal-trip-name">{trip.name}</span>
    <div class="journal-stats">
      <span>{formatDateRange(trip.startDate, trip.endDate)}</span>
      {#if stops.length}<span>{visitedCount}/{stops.length} stops visited</span>{/if}
      {#if total > 0}<span>{formatGBP(total)} spent</span>{/if}
      {#if photos.length}<span>{photos.length} photograph{photos.length > 1 ? 's' : ''}</span>{/if}
    </div>
  </div>

  {#if mappedStops.length}
    <div class="journal-map">
      <span class="section-title">The route</span>
      {#key mappedStops.length}
        <StopsMap {stops} readonly />
      {/key}
    </div>
  {/if}

  {#each segments as seg, i (i)}
    {#if seg.kind === 'md'}
      <article class="prose">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised in renderPlan() -->
        {@html renderPlan(seg.text).html}
      </article>
    {:else if assignment.photoForSegment[i]}
      {@const p = assignment.photoForSegment[i]!}
      <figure class="journal-photo">
        <img src={urls[p.id]} alt={captionFor(p)} loading="lazy" />
        <figcaption>{captionFor(p)}</figcaption>
      </figure>
    {/if}
  {/each}

  {#if assignment.leftovers.length}
    <div class="journal-gallery">
      <span class="section-title">More photographs</span>
      <div class="journal-gallery-grid">
        {#each assignment.leftovers as p (p.id)}
          <figure class="journal-photo journal-photo--small">
            <img src={urls[p.id]} alt={captionFor(p)} loading="lazy" />
            <figcaption>{captionFor(p)}</figcaption>
          </figure>
        {/each}
      </div>
    </div>
  {/if}
</div>

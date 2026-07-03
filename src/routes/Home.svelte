<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type Trip } from '../lib/db';
  import { presetByType } from '../lib/presets';
  import { formatDateRange } from '../lib/format';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';

  const tripsQ = liveQuery(() => db.trips.orderBy('order').reverse().toArray());
  const trips = $derived($tripsQ ?? []);

  // Past trips (marked Done) live in their own journal section below.
  const current = $derived(trips.filter((t) => t.status !== 'done'));
  const past = $derived(trips.filter((t) => t.status === 'done'));

  const statusLabel: Record<string, string> = {
    planning: 'Planning',
    active: 'Active',
    done: 'Done',
  };

  // Cover thumbnails for the past-trips journal shelf (first photo per trip).
  let covers = $state<Record<string, string>>({});
  $effect(() => {
    const ids = past.map((t) => t.id);
    let cancelled = false;
    const map: Record<string, string> = {};
    void Promise.all(
      ids.map(async (id) => {
        const p = await db.photos
          .where('tripId')
          .equals(id)
          .and((x) => x.kind === 'stop')
          .first();
        if (p) map[id] = URL.createObjectURL(p.blob);
      }),
    ).then(() => {
      if (cancelled) {
        for (const u of Object.values(map)) URL.revokeObjectURL(u);
      } else {
        covers = map;
      }
    });
    return () => {
      cancelled = true;
      for (const u of Object.values(map)) URL.revokeObjectURL(u);
    };
  });

  function meta(trip: Trip): string {
    return `${presetByType(trip.type).label} · ${formatDateRange(trip.startDate, trip.endDate)} · ${statusLabel[trip.status] ?? trip.status}`;
  }
</script>

<div class="screen-frame">
  <TopBar title="systema">
    {#snippet actions()}
      <a class="icon-btn" href="#/settings" aria-label="Settings"><Icon name="settings" /></a>
    {/snippet}
  </TopBar>

  <div class="screen-body">
    <a class="btn btn--primary new-trip" href="#/new">
      <Icon name="plus" size={20} /> New trip
    </a>

    <a class="btn btn--ghost new-trip" href="#/insights">
      <Icon name="expenses" size={20} /> Insights — every trip, every pound
    </a>

    {#if trips.length === 0}
      <div class="card empty-state">
        <p class="empty-title">No trips yet</p>
        <p class="hint">
          Create a trip and build its research prompt — or, if your data lives on another device or
          the NAS, restore it here first.
        </p>
        <a class="btn btn--ghost" href="#/settings">Restore a backup</a>
      </div>
    {:else}
      {#if current.length}
        <div class="trip-list">
          {#each current as trip (trip.id)}
            <a class="card trip-card" href={`#/trip/${trip.id}/plan`}>
              <span class="trip-card-name">{trip.name}</span>
              <span class="trip-card-meta">{meta(trip)}</span>
            </a>
          {/each}
        </div>
      {/if}

      {#if past.length}
        <span class="section-title past-title">Trip journal</span>
        <div class="trip-list">
          {#each past as trip (trip.id)}
            <a class="card trip-card trip-card--past" href={`#/trip/${trip.id}/plan`}>
              <span class="trip-card-main">
                <span class="trip-card-name">{trip.name}</span>
                <span class="trip-card-meta">
                  {formatDateRange(trip.startDate, trip.endDate)}
                  {#if (trip.journalText ?? '').trim()}· Journal{:else}· No journal yet{/if}
                </span>
              </span>
              {#if covers[trip.id]}
                <img class="trip-cover" src={covers[trip.id]} alt="" loading="lazy" />
              {/if}
            </a>
          {/each}
        </div>
        <p class="hint">
          Mark a trip as Done (Edit trip → Status) to shelve it here. Everything stays — plan,
          stops, notes, photos, expenses and journal.
        </p>
      {/if}
    {/if}
  </div>
</div>

<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type City, type Trip } from '../lib/db';
  import { tripDisplayName, tripMetaLabel } from '../lib/trip-shape';
  import { realExpenses, tripTotalGBP } from '../lib/expenses';
  import { formatGBP } from '../lib/money';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';
  import TripCover from '../components/TripCover.svelte';

  const tripsQ = liveQuery(() => db.trips.orderBy('order').reverse().toArray());
  const citiesQ = liveQuery(() => db.cities.toArray());
  const expensesQ = liveQuery(() => db.expenses.toArray());
  const trips = $derived($tripsQ ?? []);
  const allCities = $derived($citiesQ ?? []);
  const allExpenses = $derived($expensesQ ?? []);

  const citiesByTrip = $derived.by(() => {
    const m: Record<string, City[]> = {};
    for (const c of allCities) (m[c.tripId] ??= []).push(c);
    return m;
  });
  const spendByTrip = $derived.by(() => {
    const grouped: Record<string, typeof allExpenses> = {};
    for (const e of allExpenses) (grouped[e.tripId] ??= []).push(e);
    const m: Record<string, number> = {};
    for (const id in grouped) m[id] = tripTotalGBP(realExpenses(grouped[id]));
    return m;
  });

  // Past trips (marked Done) live in their own journal section below.
  const current = $derived(trips.filter((t) => t.status !== 'done'));
  const past = $derived(trips.filter((t) => t.status === 'done'));

  const statusLabel: Record<string, string> = {
    planning: 'Planning',
    active: 'Active',
    done: 'Done',
  };

  function citiesFor(trip: Trip): City[] {
    return citiesByTrip[trip.id] ?? [];
  }

  function currentMeta(trip: Trip): string {
    const base = tripMetaLabel(trip, citiesFor(trip));
    return base
      ? `${base} · ${statusLabel[trip.status] ?? trip.status}`
      : (statusLabel[trip.status] ?? trip.status);
  }

  function pastMeta(trip: Trip): string {
    const spend = spendByTrip[trip.id] ?? 0;
    const parts = [tripMetaLabel(trip, citiesFor(trip))];
    if (spend > 0) parts.push(formatGBP(spend));
    parts.push((trip.journalText ?? '').trim() ? 'Journal' : 'No journal yet');
    return parts.filter(Boolean).join(' · ');
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
              <span class="trip-card-name">{tripDisplayName(trip, citiesFor(trip))}</span>
              <span class="trip-card-meta">{currentMeta(trip)}</span>
            </a>
          {/each}
        </div>
      {/if}

      {#if past.length}
        <span class="section-title past-title">Trip journal</span>
        <div class="trip-list">
          {#each past as trip (trip.id)}
            <a class="card trip-card trip-card--past" href={`#/trip/${trip.id}/plan`}>
              <TripCover {trip} size="thumb" />
              <span class="trip-card-main">
                <span class="trip-card-name">{tripDisplayName(trip, citiesFor(trip))}</span>
                <span class="trip-card-meta">{pastMeta(trip)}</span>
              </span>
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

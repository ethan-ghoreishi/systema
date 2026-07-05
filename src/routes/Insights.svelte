<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import { buildOverview, buildCityInsights } from '../lib/insights';
  import { buildAllTripsCsv } from '../lib/csv';
  import { formatGBP } from '../lib/money';
  import { formatDateRange } from '../lib/format';
  import { tripDisplayName } from '../lib/trip-shape';
  import type { City } from '../lib/db';
  import { downloadText } from '../lib/download';
  import { todayIso } from '../lib/sheet';

  /**
   * The whole ledger at a glance: every trip, every pound, all offline. This is
   * the app-as-source-of-truth view; CSV export feeds the master sheet when
   * the tax records need updating.
   */

  const tripsQ = liveQuery(() => db.trips.toArray());
  const expensesQ = liveQuery(() => db.expenses.toArray());
  const citiesQ = liveQuery(() => db.cities.toArray());
  const trips = $derived($tripsQ ?? []);
  const expenses = $derived($expensesQ ?? []);
  const cities = $derived($citiesQ ?? []);

  const overview = $derived(buildOverview(trips, expenses));
  const cityInsights = $derived(buildCityInsights(trips, expenses));
  const cityCount = $derived(new Set(cities.map((c) => c.name.trim().toLowerCase())).size);

  let citySort = $state<'total' | 'perDay'>('total');
  const sortedCities = $derived(
    [...cityInsights.cities].sort((a, b) =>
      citySort === 'perDay' ? b.perDay - a.perDay : b.total - a.total,
    ),
  );

  const citiesByTrip = $derived.by(() => {
    const m: Record<string, City[]> = {};
    for (const c of cities) (m[c.tripId] ??= []).push(c);
    return m;
  });

  let status = $state('');

  function exportAllCsv() {
    downloadText(
      `systema-expenses-${todayIso()}.csv`,
      buildAllTripsCsv(trips, expenses),
      'text/csv',
    );
    status = 'CSV downloaded — paste into the master sheet when reconciling.';
  }

  function share(total: number, of: number): number {
    return of > 0 ? Math.max(2, Math.round((total / of) * 100)) : 0;
  }
</script>

<div class="screen-frame">
  <TopBar title="Insights" back="#/" />

  <div class="screen-body">
    <div class="stat-grid">
      <div class="card stat">
        <span class="stat-value">{overview.tripCount}</span>
        <span class="stat-label">trips</span>
      </div>
      <div class="card stat">
        <span class="stat-value">{cityCount}</span>
        <span class="stat-label">cities</span>
      </div>
      <div class="card stat">
        <span class="stat-value">{formatGBP(overview.total)}</span>
        <span class="stat-label">all-time spend</span>
      </div>
      <div class="card stat">
        <span class="stat-value">{formatGBP(overview.average)}</span>
        <span class="stat-label">per trip</span>
      </div>
    </div>

    {#if overview.byCategory.length}
      <div class="card">
        <h2 class="section-title">By category</h2>
        {#each overview.byCategory as c (c.category)}
          <div class="bar-row">
            <div class="bar-head">
              <span class="bar-label">{c.category}</span>
              <span class="bar-amt">{formatGBP(c.total)}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style={`width:${share(c.total, overview.total)}%`}></div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if cityInsights.cities.length}
      <div class="card">
        <div class="card-head">
          <h2 class="section-title">By city</h2>
          <div class="chips chips--sort">
            <button
              class="chip chip--sm"
              class:chip--on={citySort === 'total'}
              onclick={() => (citySort = 'total')}>Total</button
            >
            <button
              class="chip chip--sm"
              class:chip--on={citySort === 'perDay'}
              onclick={() => (citySort = 'perDay')}>Per day</button
            >
          </div>
        </div>

        {#if cityInsights.cheapest && cityInsights.priciest && cityInsights.cheapest.name !== cityInsights.priciest.name}
          <div class="city-extremes">
            <div class="city-extreme city-extreme--cheap">
              <span class="city-extreme-tag">Best value</span>
              <span class="city-extreme-name">{cityInsights.cheapest.name}</span>
              <span class="city-extreme-val">{formatGBP(cityInsights.cheapest.perDay)}/day</span>
            </div>
            <div class="city-extreme city-extreme--dear">
              <span class="city-extreme-tag">Priciest</span>
              <span class="city-extreme-name">{cityInsights.priciest.name}</span>
              <span class="city-extreme-val">{formatGBP(cityInsights.priciest.perDay)}/day</span>
            </div>
          </div>
        {/if}

        {#each sortedCities as c (c.name)}
          <div class="bar-row">
            <div class="bar-head">
              <span class="bar-label">
                {c.name}
                <span class="bar-sub"
                  >{c.tripCount} trip{c.tripCount > 1 ? 's' : ''}{#if c.days > 0}
                    · {c.days} day{c.days > 1 ? 's' : ''}{/if}</span
                >
              </span>
              <span class="bar-amt">
                {formatGBP(c.total)}
                {#if c.perDay > 0}<span class="bar-sub">{formatGBP(c.perDay)}/day</span>{/if}
              </span>
            </div>
            <div class="bar-track">
              <div
                class="bar-fill"
                style={`width:${share(citySort === 'perDay' ? c.perDay : c.total, citySort === 'perDay' ? cityInsights.maxPerDay : cityInsights.maxTotal)}%`}
              ></div>
            </div>
          </div>
        {/each}
        <p class="hint">
          By where each expense was spent. Per-day shares a trip's length across its cities — a
          quick read on which places are good value.
        </p>
      </div>
    {/if}

    {#if overview.trips.length}
      <div class="card">
        <h2 class="section-title">Every trip</h2>
        {#each overview.trips as s (s.trip.id)}
          <a class="bar-row bar-row--link" href={`#/trip/${s.trip.id}/expenses`}>
            <div class="bar-head">
              <span class="bar-label">
                {tripDisplayName(s.trip, citiesByTrip[s.trip.id] ?? [])}
                <span class="bar-sub">{formatDateRange(s.trip.startDate, s.trip.endDate)}</span>
              </span>
              <span class="bar-amt">{formatGBP(s.total)}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style={`width:${share(s.total, overview.maxTripTotal)}%`}></div>
            </div>
          </a>
        {/each}
      </div>
    {:else}
      <div class="card empty-state">
        <p class="empty-title">Nothing to show yet</p>
        <p class="hint">Add expenses to a trip, or import your travel history backup.</p>
      </div>
    {/if}

    <button class="btn btn--ghost" onclick={exportAllCsv} disabled={expenses.length === 0}>
      Download all expenses (CSV, sheet format)
    </button>
    {#if status}<p class="hint hint--ok">{status}</p>{/if}
  </div>
</div>

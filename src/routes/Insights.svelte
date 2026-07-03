<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import { buildOverview } from '../lib/insights';
  import { buildAllTripsCsv } from '../lib/csv';
  import { formatGBP } from '../lib/money';
  import { formatDateRange } from '../lib/format';
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
  const cityCount = $derived(new Set(cities.map((c) => c.name.trim().toLowerCase())).size);

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

    {#if overview.trips.length}
      <div class="card">
        <h2 class="section-title">Every trip</h2>
        {#each overview.trips as s (s.trip.id)}
          <a class="bar-row bar-row--link" href={`#/trip/${s.trip.id}/expenses`}>
            <div class="bar-head">
              <span class="bar-label">
                {s.trip.name}
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

<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import {
    METRICS,
    buildOverview,
    compareCities,
    dataQuality,
    transitRows,
    tripRhythm,
    type CompareMetric,
  } from '../lib/insights';
  import { buildAllTripsCsv, csvNote } from '../lib/csv';
  import { formatGBP } from '../lib/money';
  import { formatDateRange } from '../lib/format';
  import { tripDisplayName } from '../lib/trip-shape';
  import type { City } from '../lib/db';
  import { downloadText } from '../lib/download';
  import { todayIso } from '../lib/sheet';
  import { router } from '../lib/router.svelte';
  import { recall, remember, scrollMemory } from '../lib/ui-memory';

  /**
   * Decisions, not charts: what a day costs in a city, how airport transfers
   * went, how trips ran against their plans — each with its sample size, and
   * nothing crowned "best" from thin data. All offline and deterministic; CSV
   * export feeds the master sheet when the records need updating.
   */

  const tripsQ = liveQuery(() => db.trips.toArray());
  const expensesQ = liveQuery(() => db.expenses.toArray());
  const citiesQ = liveQuery(() => db.cities.toArray());
  const stopsQ = liveQuery(() => db.stops.toArray());
  const momentsQ = liveQuery(() => db.moments.toArray());
  const trips = $derived($tripsQ ?? []);
  const expenses = $derived($expensesQ ?? []);
  const cities = $derived($citiesQ ?? []);
  const stops = $derived($stopsQ ?? []);
  const moments = $derived($momentsQ ?? []);

  const overview = $derived(buildOverview(trips, expenses));
  const quality = $derived(dataQuality(trips, cities, expenses));
  const cityCount = $derived(new Set(cities.map((c) => c.name.trim().toLowerCase())).size);

  let metric = $state<CompareMetric>(recall('insights:metric', 'perDay'));
  $effect(() => remember('insights:metric', metric));
  const comparison = $derived(compareCities(trips, cities, expenses, stops, metric));
  const maxValue = $derived(Math.max(0, ...comparison.rows.map((r) => r.value)));
  const transit = $derived(transitRows(trips, cities, expenses).slice(0, 12));
  const rhythm = $derived(tripRhythm(trips, cities, expenses, stops, moments).slice(0, 6));

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
    status = `CSV downloaded — paste into the master sheet when reconciling.${csvNote(expenses)}`;
  }

  function share(total: number, of: number): number {
    return of > 0 ? Math.max(2, Math.round((total / of) * 100)) : 0;
  }

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
</script>

<div class="screen-frame">
  <TopBar title="Insights" onBack={() => router.back('/')} />

  <div class="screen-body" use:scrollMemory={router.path}>
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

    <details class="card data-quality">
      <summary class="section-title">What this rests on</summary>
      <p class="hint">
        {plural(quality.expenses, 'expense')} across {plural(quality.tripsWithSpend, 'trip')}; {quality.legsTimed}
        of {plural(quality.legs, 'leg')} have arrival and departure times.
      </p>
      {#if quality.shared.count}
        <p class="hint">
          {formatGBP(quality.shared.total)} in {plural(quality.shared.count, 'trip-wide expense')} (flights,
          a hotel for two cities…) is kept apart — never split between cities.
        </p>
      {/if}
      {#if quality.unlinked.count}
        <p class="hint hint--warn">
          {plural(quality.unlinked.count, 'expense')} ({formatGBP(quality.unlinked.total)}) name no
          city of their trip, so city figures leave them out.
        </p>
      {/if}
      {#if quality.unpriced}
        <p class="hint">
          {plural(quality.unpriced, 'expense')} still awaiting an exchange rate are left out until priced.
        </p>
      {/if}
      <p class="hint">
        Days come from leg times; an older single-city trip without times counts its calendar days
        (marked ≈).
      </p>
    </details>

    <div class="card">
      <h2 class="section-title">Compare cities, one question at a time</h2>
      <div class="chips" role="tablist" aria-label="Question">
        {#each Object.entries(METRICS) as [key, m] (key)}
          <button
            class="chip chip--sm"
            class:chip--on={metric === key}
            role="tab"
            aria-selected={metric === key}
            onclick={() => (metric = key as CompareMetric)}>{m.label}</button
          >
        {/each}
      </div>
      <p class="hint">{METRICS[metric].explain}</p>
      {#if comparison.rows.length}
        {#each comparison.rows as r (r.name)}
          <div class="bar-row">
            <div class="bar-head">
              <span class="bar-label">
                {r.name}
                <span class="bar-sub"
                  >{plural(r.visits, 'visit')}{#if metric === 'perDay' || metric === 'foodPerDay'}
                    · {r.approximate ? '≈' : ''}{r.days} day{r.days === 1
                      ? ''
                      : 's'}{/if}{#if r.thin}
                    · one visit, a reading not a pattern{/if}</span
                >
              </span>
              <span class="bar-amt">{formatGBP(r.value)}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style={`width:${share(r.value, maxValue)}%`}></div>
            </div>
          </div>
        {/each}
      {:else}
        <p class="hint">No city has the data for this yet.</p>
      {/if}
      {#if comparison.missing.length}
        <p class="hint">Not enough data: {comparison.missing.join(', ')}.</p>
      {/if}
    </div>

    {#if transit.length}
      <div class="card">
        <h2 class="section-title">Airport transfers</h2>
        {#each transit as t (t.key)}
          <div class="transit-row">
            <span class="bar-label"
              >{t.city}
              <span class="bar-sub">{t.trip}{t.date ? ` · ${t.date.slice(0, 7)}` : ''}</span></span
            >
            <span class="hint"
              >{t.mode}{t.costPP != null
                ? ` · ${formatGBP(t.costPP)} per person`
                : ''}{t.journeyMin != null ? ` · ${t.journeyMin} min` : ''}</span
            >
            {#if t.notes}<span class="hint">{t.notes}</span>{/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if rhythm.length}
      <div class="card">
        <h2 class="section-title">Trip rhythm</h2>
        {#each rhythm as r (r.tripId)}
          <a class="transit-row bar-row--link" href={`#/trip/${r.tripId}/stops`}>
            <span class="bar-label"
              >{r.name}
              <span class="bar-sub">{r.days ? plural(r.days, 'day') : ''}</span></span
            >
            <span class="hint">
              {r.visited} of {r.planned} planned stops visited{r.offPlan
                ? ` · ${plural(r.offPlan, 'off-plan moment')}`
                : ''} · {plural(r.rides, 'ride')} logged{r.perVisitedStop != null
                ? ` · ${formatGBP(r.perVisitedStop)} per place visited`
                : ''}{r.slackMin != null
                ? ` · ${r.slackMin} min planned slack before ${plural(r.departures, 'departure')}`
                : ''}
            </span>
          </a>
        {/each}
      </div>
    {/if}

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

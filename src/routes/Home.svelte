<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type City, type Trip } from '../lib/db';
  import { tripDisplayName, tripMetaLabel } from '../lib/trip-shape';
  import { realExpenses, tripTotalGBP } from '../lib/expenses';
  import { formatGBP } from '../lib/money';
  import TopBar from '../components/TopBar.svelte';
  import { scrollMemory } from '../lib/ui-memory';
  import { navigate, router } from '../lib/router.svelte';
  import Icon from '../components/Icon.svelte';
  import TripCover from '../components/TripCover.svelte';
  import { conflictsQuery } from '../lib/conflicts';
  import FinderImport from '../components/FinderImport.svelte';
  import { isPast, optionDates, viewOpportunity } from '../lib/options';
  import { createOpportunity, measuredFacts } from '../lib/opportunities';
  import { nasBackup } from '../lib/nas.svelte';
  import { clockLabel, nextDeparture, tripDepartures } from '../lib/readiness';

  const tripsQ = liveQuery(() => db.trips.orderBy('order').reverse().toArray());
  const oppsQ = liveQuery(() => db.opportunities.toArray());
  const citiesQ = liveQuery(() => db.cities.toArray());
  const expensesQ = liveQuery(() => db.expenses.toArray());
  const conflictsQ = liveQuery(conflictsQuery);
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

  // Nudge only when action is needed: never backed up, or not for a week.
  const backupNotice = $derived.by(() => {
    if (!trips.length || !nasBackup.healthLoaded) return '';
    const failed = Object.keys(nasBackup.failures).length;
    if (failed) return `${failed} photo${failed > 1 ? 's' : ''} not backed up — review`;
    // lastDataAt: devices upgraded from the push-only version have only this.
    const last = Math.max(
      nasBackup.lastSyncAt ?? 0,
      nasBackup.lastDataAt ?? 0,
      nasBackup.lastFileBackupAt ?? 0,
    );
    if (!last) return 'Not backed up yet — set up a backup';
    if (Date.now() - last > 7 * 86_400_000)
      return `Last backup ${new Date(last).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — back up now`;
    return '';
  });

  // A calm line on a trip whose next departure is within a day and a half.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(t);
  });
  function leaveLine(trip: Trip): string {
    const d = nextDeparture(tripDepartures(trip, citiesFor(trip)), now);
    if (!d || d.leaveBy - now > 36 * 3_600_000) return '';
    return d.leaveBy <= now
      ? `Time to leave for ${d.hub}`
      : `Leave for ${d.hub} by ${clockLabel(d.leaveBy, d.tz, now)}`;
  }

  // Past trips (marked Done) live in their own journal section below.
  const current = $derived(trips.filter((t) => t.status !== 'done'));
  const past = $derived(trips.filter((t) => t.status === 'done'));

  // Destinations under consideration. The ledger-measured costs are a live
  // query, not a figure fetched once: a transfer logged this morning has to
  // move the comparison that quotes it.
  const factsQ = liveQuery(() => measuredFacts());
  const facts = $derived($factsQ ?? null);
  // A destination leaves Considering while a trip from it is still to happen.
  // Once that trip is done the place is open again: the same city is worth
  // going back to, and the research is already here.
  const chosenOppIds = $derived(
    new Set(
      trips
        .filter((t) => t.status !== 'done')
        .map((t) => t.opportunityId)
        .filter(Boolean),
    ),
  );
  const ideas = $derived.by(() => {
    const rows = ($oppsQ ?? [])
      .filter((o) => !chosenOppIds.has(o.id))
      .map((o) => {
        const view = facts ? viewOpportunity(o, facts) : null;
        return { opp: o, view, past: isPast(o, false) };
      });
    const cheapest = (r: (typeof rows)[number]) => r.view?.best?.totalPP ?? Infinity;
    return [
      ...rows.filter((r) => !r.past).sort((a, b) => cheapest(a) - cheapest(b)),
      ...rows.filter((r) => r.past).sort((a, b) => a.opp.city.localeCompare(b.opp.city)),
    ];
  });
  // Places still worth a look, and places whose fares have been overtaken: the
  // second kind is research to come back to, not a shortlist to read past.
  const live = $derived(ideas.filter((r) => !r.past));
  const gone = $derived(ideas.filter((r) => r.past));

  function ideaMeta(row: (typeof ideas)[number]): string {
    if (row.past) return 'dates passed · what you know is kept';
    const n = row.view?.rows.length ?? row.opp.options.length;
    const parts = [`${n} option${n === 1 ? '' : 's'}`];
    const best = row.view?.best;
    if (best?.totalPP != null) parts.push(`from ${formatGBP(best.totalPP)} each`);
    if (best) parts.push(optionDates(best.option));
    return parts.join(' · ');
  }

  let importing = $state(false);
  let importStatus = $state('');
  // Most research starts in Google Flights, not in a search the finder ran.
  let addingCity = $state(false);
  let newCity = $state('');
  let newCountry = $state('');
  async function addDestination() {
    const city = newCity.trim();
    if (!city) return;
    const id = await createOpportunity(city, newCountry.trim() || undefined);
    newCity = '';
    newCountry = '';
    addingCity = false;
    navigate(`/opp/${id}`);
  }

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

  <div class="screen-body" use:scrollMemory={router.path}>
    <a class="btn btn--primary new-trip" href="#/new">
      <Icon name="plus" size={20} /> New trip
    </a>

    {#if $conflictsQ?.length}
      <a class="hint hint--warn home-notice" href="#/settings">
        {$conflictsQ.length} edit{$conflictsQ.length > 1 ? 's' : ''} made on two devices — review
      </a>
    {:else if backupNotice}
      <a class="hint hint--warn home-notice" href="#/settings">{backupNotice}</a>
    {/if}

    {#if importStatus}<p class="hint hint--ok" role="status">{importStatus}</p>{/if}

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
              {#if leaveLine(trip)}<span class="trip-card-leave">{leaveLine(trip)}</span>{/if}
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

    <span class="section-title past-title">Considering</span>
    {#if live.length}
      <div class="trip-list">
        {#each live as row (row.opp.id)}
          <a class="card trip-card" href={`#/opp/${row.opp.id}`}>
            <span class="trip-card-name"
              >{row.opp.city}{#if row.opp.country}<small>, {row.opp.country}</small>{/if}</span
            >
            <span class="trip-card-meta">{ideaMeta(row)}</span>
          </a>
        {/each}
      </div>
    {:else if !gone.length}
      <p class="hint">
        Somewhere you are thinking about, with the ways of getting there side by side. What you
        learn about a place stays here after the fares have gone stale.
      </p>
    {/if}
    {#if gone.length}
      <!-- Dates that have gone are research, not a shortlist: one line here,
           everything still inside. -->
      <details class="opt-work">
        <summary class="section-title"
          >{gone.length} where the dates have gone — what you learned is kept</summary
        >
        <div class="trip-list">
          {#each gone as row (row.opp.id)}
            <a class="card trip-card trip-card--past" href={`#/opp/${row.opp.id}`}>
              <span class="trip-card-name"
                >{row.opp.city}{#if row.opp.country}<small>, {row.opp.country}</small>{/if}</span
              >
              <span class="trip-card-meta">{ideaMeta(row)}</span>
            </a>
          {/each}
        </div>
      </details>
    {/if}

    {#if addingCity}
      <div class="card">
        <label class="label" for="new-city">Where</label>
        <input id="new-city" class="field" type="text" placeholder="Faro" bind:value={newCity} />
        <label class="label" for="new-country">Country</label>
        <input
          id="new-country"
          class="field"
          type="text"
          placeholder="Portugal"
          bind:value={newCountry}
        />
        <p class="hint">
          The country keeps two places of the same name apart — Valencia in Spain is not Valencia in
          Venezuela.
        </p>
        <div class="cluster">
          <button class="btn btn--primary" onclick={addDestination} disabled={!newCity.trim()}
            >Add</button
          >
          <button class="btn btn--ghost" onclick={() => (addingCity = false)}>Cancel</button>
        </div>
      </div>
    {:else}
      <div class="cluster">
        <button class="btn btn--ghost btn--sm" onclick={() => (addingCity = true)}
          >Add a destination</button
        >
        <button class="btn btn--ghost btn--sm" onclick={() => (importing = true)}
          >Add a finder search</button
        >
      </div>
    {/if}

    <a class="btn btn--ghost new-trip" href="#/insights">
      <Icon name="expenses" size={20} /> Insights — every trip, every pound
    </a>
  </div>
</div>

{#if importing}
  <FinderImport onClose={() => (importing = false)} onDone={(m) => (importStatus = m)} />
{/if}

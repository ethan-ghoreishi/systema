<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';
  import PlanTab from '../components/tabs/PlanTab.svelte';
  import StopsTab from '../components/tabs/StopsTab.svelte';
  import ExpensesTab from '../components/tabs/ExpensesTab.svelte';
  import ExportTab from '../components/tabs/ExportTab.svelte';
  import MomentCapture from '../components/MomentCapture.svelte';
  import { tripDisplayName } from '../lib/trip-shape';
  import { router, outsideTrip } from '../lib/router.svelte';
  import { scrollMemory } from '../lib/ui-memory';

  let { id, tab }: { id: string; tab: string } = $props();

  // A stop's detail lives at #/trip/:id/stops/:stopId; its Back belongs in this
  // persistent header (not the scrolling content) and returns to the list.
  const stopOpen = $derived(tab === 'stops' && !!router.path.split('/').filter(Boolean)[3]);
  function back() {
    if (stopOpen) router.back(`/trip/${id}/stops`, (p) => p === `/trip/${id}/stops`);
    else router.back('/', outsideTrip(id));
  }

  // null = not found, undefined = still loading.
  const tripQ = liveQuery(async () => (await db.trips.get(id)) ?? null);
  const citiesQ = liveQuery(() => db.cities.where('tripId').equals(id).sortBy('order'));
  const stopsQ = liveQuery(() => db.stops.where('tripId').equals(id).sortBy('order'));
  const trip = $derived($tripQ);
  const cities = $derived($citiesQ ?? []);
  let capturing = $state(false);

  const tabs = [
    { key: 'plan', label: 'Plan', icon: 'plan' },
    { key: 'stops', label: 'Stops', icon: 'stops' },
    { key: 'expenses', label: 'Expenses', icon: 'expenses' },
    { key: 'export', label: 'Export', icon: 'export' },
  ];
</script>

{#if trip === undefined}
  <div class="screen-frame">
    <TopBar title="…" onBack={back} />
    <div class="screen-body"><p class="hint">Loading…</p></div>
  </div>
{:else if trip === null}
  <div class="screen-frame">
    <TopBar title="Trip" onBack={() => router.back('/', outsideTrip(id))} />
    <div class="screen-body">
      <div class="card empty-state">
        <p class="empty-title">Trip not found</p>
        <a class="btn btn--ghost" href="#/" data-replace>Back to trips</a>
      </div>
    </div>
  </div>
{:else}
  <div class="screen-frame screen-frame--tabbed">
    <TopBar
      title={tripDisplayName(trip, cities)}
      onBack={back}
      backLabel={stopOpen ? 'Stops' : undefined}
    >
      {#snippet actions()}
        <button class="icon-btn" aria-label="What happened?" onclick={() => (capturing = true)}
          ><Icon name="spark" /></button
        >
        <a class="icon-btn" href={`#/trip/${id}/edit`} aria-label="Edit trip"
          ><Icon name="edit" /></a
        >
      {/snippet}
    </TopBar>

    <div class="screen-body" use:scrollMemory={router.path}>
      {#if tab === 'stops'}
        <StopsTab {trip} />
      {:else if tab === 'expenses'}
        <ExpensesTab {trip} />
      {:else if tab === 'export'}
        <ExportTab {trip} />
      {:else}
        <PlanTab {trip} />
      {/if}
    </div>

    <nav class="tabbar" aria-label="Trip sections">
      {#each tabs as t (t.key)}
        <a
          class="tab"
          class:tab--active={tab === t.key}
          href={`#/trip/${id}/${t.key}`}
          data-replace
          aria-current={tab === t.key ? 'page' : undefined}
        >
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </a>
      {/each}
    </nav>
  </div>
  {#if capturing}
    <MomentCapture {trip} {cities} stops={$stopsQ ?? []} onClose={() => (capturing = false)} />
  {/if}
{/if}

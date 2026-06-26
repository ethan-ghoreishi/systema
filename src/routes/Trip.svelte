<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';
  import PlanTab from '../components/tabs/PlanTab.svelte';
  import StopsTab from '../components/tabs/StopsTab.svelte';
  import ExpensesTab from '../components/tabs/ExpensesTab.svelte';
  import ExportTab from '../components/tabs/ExportTab.svelte';

  let { id, tab }: { id: string; tab: string } = $props();

  // null = not found, undefined = still loading.
  const tripQ = liveQuery(async () => (await db.trips.get(id)) ?? null);
  const trip = $derived($tripQ);

  const tabs = [
    { key: 'plan', label: 'Plan', icon: 'plan' },
    { key: 'stops', label: 'Stops', icon: 'stops' },
    { key: 'expenses', label: 'Expenses', icon: 'expenses' },
    { key: 'export', label: 'Export', icon: 'export' },
  ];
</script>

{#if trip === undefined}
  <div class="screen-frame">
    <TopBar title="…" back="#/" />
    <div class="screen-body"><p class="hint">Loading…</p></div>
  </div>
{:else if trip === null}
  <div class="screen-frame">
    <TopBar title="Trip" back="#/" />
    <div class="screen-body">
      <div class="card empty-state">
        <p class="empty-title">Trip not found</p>
        <a class="btn btn--ghost" href="#/">Back to trips</a>
      </div>
    </div>
  </div>
{:else}
  <div class="screen-frame screen-frame--tabbed">
    <TopBar title={trip.name} back="#/">
      {#snippet actions()}
        <a class="icon-btn" href={`#/trip/${id}/edit`} aria-label="Edit trip"
          ><Icon name="edit" /></a
        >
      {/snippet}
    </TopBar>

    <div class="screen-body">
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
          aria-current={tab === t.key ? 'page' : undefined}
        >
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </a>
      {/each}
    </nav>
  </div>
{/if}

<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { presetByType } from '../lib/presets';
  import { formatDateRange } from '../lib/format';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';

  const trips = liveQuery(() => db.trips.orderBy('order').reverse().toArray());

  const statusLabel: Record<string, string> = {
    planning: 'Planning',
    active: 'Active',
    done: 'Done',
  };

  function meta(type: string, start: string, end: string, status: string): string {
    return `${presetByType(type as never).label} · ${formatDateRange(start, end)} · ${statusLabel[status] ?? status}`;
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

    {#if ($trips?.length ?? 0) === 0}
      <div class="card empty-state">
        <p class="empty-title">No trips yet</p>
        <p class="hint">
          Create a trip, paste your plan, and run it offline. Tip: build the plan on the phone
          you'll actually travel with — or move it across later via Export → JSON.
        </p>
      </div>
    {:else}
      <div class="trip-list">
        {#each $trips ?? [] as trip (trip.id)}
          <a class="card trip-card" href={`#/trip/${trip.id}/plan`}>
            <span class="trip-card-name">{trip.name}</span>
            <span class="trip-card-meta"
              >{meta(trip.type, trip.startDate, trip.endDate, trip.status)}</span
            >
          </a>
        {/each}
      </div>
    {/if}
  </div>
</div>

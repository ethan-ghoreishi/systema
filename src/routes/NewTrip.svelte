<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import { tripPresets } from '../lib/presets';
  import { createTrip } from '../lib/trips';
  import { navigate } from '../lib/router.svelte';
  import type { TripType } from '../lib/db';

  let creating = $state(false);

  async function choose(type: TripType) {
    if (creating) return;
    creating = true;
    const id = await createTrip(type);
    // Straight into edit to set name, dates, return time and cities.
    navigate(`/trip/${id}/edit`);
  }
</script>

<div class="screen-frame">
  <TopBar title="New trip" back="#/" />

  <div class="screen-body">
    <p class="hint">
      Pick a starting point — it just seeds the usual expense rows. You'll add cities and times
      next, and the app works out the trip's shape, dates and name from those.
    </p>

    {#each tripPresets as preset (preset.type)}
      <button class="card preset-card" onclick={() => choose(preset.type)} disabled={creating}>
        <span class="preset-label">{preset.label}</span>
        <span class="preset-blurb">{preset.blurb}</span>
      </button>
    {/each}
  </div>
</div>

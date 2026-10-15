<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import { scrollMemory } from '../lib/ui-memory';
  import { tripPresets } from '../lib/presets';
  import { createTrip } from '../lib/trips';
  import { navigate, router } from '../lib/router.svelte';

  let creating = $state(false);

  async function choose(key: string) {
    if (creating) return;
    creating = true;
    const id = await createTrip(key);
    // Straight into edit to set the legs. Replaces this chooser in history, so
    // Back from the new trip never lands on it again.
    navigate(`/trip/${id}/edit`, { replace: true });
  }
</script>

<div class="screen-frame">
  <TopBar title="New trip" onBack={() => router.back('/')} />

  <div class="screen-body" use:scrollMemory={router.path}>
    <p class="hint">
      Pick a starting point — it just seeds the usual expense rows. You'll add cities and times
      next, and the app works out the trip's shape, dates and name from those.
    </p>

    {#each tripPresets as preset (preset.key)}
      <button class="card preset-card" onclick={() => choose(preset.key)} disabled={creating}>
        <span class="preset-label">{preset.label}</span>
        <span class="preset-blurb">{preset.blurb}</span>
      </button>
    {/each}
  </div>
</div>

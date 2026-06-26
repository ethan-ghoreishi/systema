<script lang="ts">
  import { onMount } from 'svelte';
  import AppShell from './components/AppShell.svelte';
  import Home from './routes/Home.svelte';
  import NewTrip from './routes/NewTrip.svelte';
  import Settings from './routes/Settings.svelte';
  import Trip from './routes/Trip.svelte';
  import TripEdit from './routes/TripEdit.svelte';
  import NotFound from './routes/NotFound.svelte';
  import UpdateToast from './components/UpdateToast.svelte';
  import { router } from './lib/router.svelte';
  import { settingsStore } from './lib/settings.svelte';
  import { initAutoSync } from './lib/sync';

  type View =
    | { name: 'home' }
    | { name: 'new' }
    | { name: 'settings' }
    | { name: 'trip'; id: string; tab: string }
    | { name: 'tripEdit'; id: string }
    | { name: 'notfound' };

  const view = $derived.by<View>(() => {
    const seg = router.path.split('/').filter(Boolean);
    if (seg.length === 0) return { name: 'home' };
    if (seg[0] === 'new') return { name: 'new' };
    if (seg[0] === 'settings') return { name: 'settings' };
    if (seg[0] === 'trip' && seg[1]) {
      if (seg[2] === 'edit') return { name: 'tripEdit', id: seg[1] };
      return { name: 'trip', id: seg[1], tab: seg[2] ?? 'plan' };
    }
    return { name: 'notfound' };
  });

  onMount(() => {
    void settingsStore.load();
    initAutoSync();
    // Ask the browser to keep our local data (best effort; reduces eviction).
    if (navigator.storage?.persist) void navigator.storage.persist();
  });
</script>

<UpdateToast />

<AppShell>
  {#if view.name === 'home'}
    <Home />
  {:else if view.name === 'new'}
    <NewTrip />
  {:else if view.name === 'settings'}
    <Settings />
  {:else if view.name === 'trip'}
    {#key view.id}
      <Trip id={view.id} tab={view.tab} />
    {/key}
  {:else if view.name === 'tripEdit'}
    {#key view.id}
      <TripEdit id={view.id} />
    {/key}
  {:else}
    <NotFound />
  {/if}
</AppShell>

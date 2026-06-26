<script lang="ts">
  import { useRegisterSW } from 'virtual:pwa-register/svelte';

  // 'prompt' registration: surface a calm toast instead of reloading mid-trip.
  const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW();

  function dismiss() {
    needRefresh.set(false);
    offlineReady.set(false);
  }
</script>

{#if $needRefresh || $offlineReady}
  <div class="toast" role="status">
    <span class="toast-text">
      {#if $needRefresh}Update available{:else}Ready to work offline{/if}
    </span>
    {#if $needRefresh}
      <button class="btn btn--primary btn--sm" onclick={() => updateServiceWorker(true)}>
        Refresh
      </button>
    {/if}
    <button class="icon-btn icon-btn--sm" aria-label="Dismiss" onclick={dismiss}>✕</button>
  </div>
{/if}

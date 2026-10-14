<script lang="ts">
  import type { Snippet } from 'svelte';
  import { connectivity } from '../lib/connectivity.svelte';
  import Icon from './Icon.svelte';

  /**
   * The persistent header. `onBack` decides where Back goes (see router.back):
   * the previous in-app screen when there is one, else the screen's parent.
   */
  let {
    title,
    onBack,
    backLabel,
    actions,
  }: { title: string; onBack?: () => void; backLabel?: string; actions?: Snippet } = $props();
</script>

<header class="topbar">
  {#if onBack}
    <button
      class="icon-btn topbar-back"
      class:topbar-back--label={!!backLabel}
      onclick={onBack}
      aria-label={backLabel ? `Back to ${backLabel}` : 'Back'}
    >
      <Icon name="back" />{#if backLabel}<span>{backLabel}</span>{/if}
    </button>
  {/if}
  <h1 class="topbar-title">{title}</h1>
  {#if !connectivity.online}
    <span class="pill pill--offline" role="status">Offline</span>
  {/if}
  {#if actions}
    <div class="topbar-actions">{@render actions()}</div>
  {/if}
</header>

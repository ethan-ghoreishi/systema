<script lang="ts">
  import type { Snippet } from 'svelte';
  import { connectivity } from '../lib/connectivity.svelte';
  import Icon from './Icon.svelte';

  let { title, back, actions }: { title: string; back?: string; actions?: Snippet } = $props();
</script>

<header class="topbar">
  {#if back}
    <a class="icon-btn" href={back} aria-label="Back"><Icon name="back" /></a>
  {/if}
  <h1 class="topbar-title">{title}</h1>
  {#if !connectivity.online}
    <span class="pill pill--offline" role="status">Offline</span>
  {/if}
  {#if actions}
    <div class="topbar-actions">{@render actions()}</div>
  {/if}
</header>

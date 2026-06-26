<script lang="ts">
  import type { Snippet } from 'svelte';

  // The outer frame: a centred, full-height column. Each screen renders its own
  // top bar and (inside a trip) tab bar, so the chrome can differ per screen.
  let { children }: { children?: Snippet } = $props();
</script>

<div class="app-shell">
  {@render children?.()}
</div>

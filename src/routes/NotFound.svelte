<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import { scrollMemory } from '../lib/ui-memory';
  import { router } from '../lib/router.svelte';
</script>

<div class="screen-frame">
  <TopBar title="Not found" onBack={() => router.back('/')} />
  <div class="screen-body" use:scrollMemory={router.path}>
    <div class="card empty-state">
      <p class="empty-title">That screen doesn't exist</p>
      <a class="btn btn--ghost" href="#/">Back to trips</a>
    </div>
  </div>
</div>

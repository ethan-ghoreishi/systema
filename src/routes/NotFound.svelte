<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
</script>

<div class="screen-frame">
  <TopBar title="Not found" back="#/" />
  <div class="screen-body">
    <div class="card empty-state">
      <p class="empty-title">That screen doesn't exist</p>
      <a class="btn btn--ghost" href="#/">Back to trips</a>
    </div>
  </div>
</div>

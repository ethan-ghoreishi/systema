<script lang="ts">
  // Big numeric keypad. Edits a string value (so partial input like "12." works).
  let { value = $bindable('') }: { value?: string } = $props();

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

  function press(k: string) {
    if (k === 'del') {
      value = value.slice(0, -1);
      return;
    }
    if (k === '.') {
      if (value.includes('.')) return;
      value = value === '' ? '0.' : value + '.';
      return;
    }
    // Cap at 2 decimal places.
    const dot = value.indexOf('.');
    if (dot !== -1 && value.length - dot > 2) return;
    value = value === '0' ? k : value + k;
  }
</script>

<div class="keypad">
  {#each keys as k (k)}
    <button
      class="key"
      type="button"
      onclick={() => press(k)}
      aria-label={k === 'del' ? 'Delete' : k}
    >
      {#if k === 'del'}⌫{:else}{k}{/if}
    </button>
  {/each}
</div>

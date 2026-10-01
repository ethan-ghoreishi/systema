<script lang="ts">
  import { liveQuery } from 'dexie';
  import {
    conflictsQuery,
    fieldLabel,
    keepCurrent,
    showValue,
    useOtherVersion,
    type Conflict,
  } from '../lib/conflicts';

  /** Edits made to the same thing on two devices: choose which one stays. */
  const conflictsQ = liveQuery(conflictsQuery);
  const conflicts = $derived($conflictsQ ?? []);
  let busy = $state(false);

  async function act(fn: (c: Conflict) => Promise<void>, c: Conflict) {
    busy = true;
    try {
      await fn(c);
    } finally {
      busy = false;
    }
  }
</script>

{#if conflicts.length}
  <div class="card" id="conflicts">
    <h2 class="section-title">Edits made on two devices</h2>
    <p class="hint">
      The same thing was changed on two devices before they synced. The newer edit is in place; the
      other is kept here until you choose. Nothing was discarded.
    </p>
    {#each conflicts as c (c.key)}
      <div class="conflict">
        <span class="conflict-label">{c.label}</span>
        {#each Object.entries(c.fields) as [field, v] (field)}
          <span class="hint">
            {fieldLabel(field)}: {c.keptDevice}’s edit is in place ({new Date(c.at).toLocaleString(
              'en-GB',
              { dateStyle: 'medium', timeStyle: 'short' },
            )})
          </span>
          <details class="pack-details">
            <summary>{c.otherDevice}’s version</summary>
            <pre class="pack-preview">{showValue(v.other)}</pre>
          </details>
          <details class="pack-details">
            <summary>Version in place</summary>
            <pre class="pack-preview">{showValue(v.kept)}</pre>
          </details>
        {/each}
        <div class="cluster">
          <button
            class="btn btn--ghost btn--sm"
            disabled={busy}
            onclick={() => act(useOtherVersion, c)}>Use {c.otherDevice}’s version</button
          >
          <button class="btn btn--ghost btn--sm" disabled={busy} onclick={() => act(keepCurrent, c)}
            >Keep the one in place</button
          >
        </div>
      </div>
    {/each}
  </div>
{/if}

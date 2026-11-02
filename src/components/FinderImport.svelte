<script lang="ts">
  import { onMount } from 'svelte';
  import {
    OptionParseError,
    optionDates,
    optionRoute,
    parseFinderCsv,
    type ParsedRow,
  } from '../lib/options';
  import { addFinderRows } from '../lib/opportunities';

  /**
   * Taking a search straight from the Cheap-Trip Finder: paste the table, or
   * pick the .csv the search saved. Nothing is retyped, and nothing is
   * imported without being chosen — a whole search is a hundred rows, and a
   * hundred destinations under consideration is a backlog, not a decision.
   */
  let { onClose, onDone }: { onClose: () => void; onDone: (message: string) => void } = $props();

  let dialogEl: HTMLDialogElement;
  let text = $state('');
  let error = $state('');
  let saving = $state(false);
  let parsed = $state<ParsedRow[] | null>(null);
  let picked = $state<string[]>([]);
  onMount(() => dialogEl.showModal());

  // Small searches are all worth a look; a big one starts with nothing ticked.
  const AUTO_PICK_MAX = 8;

  function read(source: string) {
    error = '';
    try {
      const rows = parseFinderCsv(source);
      parsed = rows;
      picked = rows.length <= AUTO_PICK_MAX ? rows.map((r) => r.option.id) : [];
    } catch (err) {
      parsed = null;
      error = err instanceof OptionParseError ? err.message : `Could not read that: ${String(err)}`;
    }
  }

  async function pickFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    text = await file.text();
    read(text);
  }

  function toggle(id: string) {
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
  }

  const chosen = $derived((parsed ?? []).filter((r) => picked.includes(r.option.id)));
  const cityCount = $derived(new Set(chosen.map((r) => r.city.toLowerCase())).size);

  async function save() {
    if (!chosen.length) return;
    saving = true;
    error = '';
    try {
      // Out of Svelte's reactive proxies before IndexedDB sees them: a proxy
      // cannot be structured-cloned, and the write would fail at the store.
      const r = await addFinderRows($state.snapshot(chosen) as ParsedRow[]);
      const bits = [
        `${r.added + r.refreshed} option${r.added + r.refreshed === 1 ? '' : 's'}`,
        `${cityCount} destination${cityCount === 1 ? '' : 's'}`,
      ];
      onDone(
        `Added ${bits[0]} across ${bits[1]}${r.refreshed ? `, ${r.refreshed} with a fresher fare` : ''}.`,
      );
      dialogEl.close();
    } catch (err) {
      error = `Not saved: ${err instanceof Error ? err.message : String(err)}. Your text is still here.`;
    } finally {
      saving = false;
    }
  }
</script>

<dialog
  class="modal"
  bind:this={dialogEl}
  onclose={onClose}
  oncancel={(e) => {
    if (saving) e.preventDefault();
  }}
>
  <div class="modal-sheet">
    <header class="modal-head">
      <button class="btn btn--ghost btn--sm" onclick={() => dialogEl.close()} disabled={saving}
        >Cancel</button
      >
      <h2 class="modal-title">From the finder</h2>
      <button class="btn btn--primary btn--sm" onclick={save} disabled={saving || !chosen.length}
        >Add {chosen.length || ''}</button
      >
    </header>
    <div class="modal-body">
      {#if !parsed}
        <p class="hint">
          Paste the Cheap-Trip Finder's table — header row and all — or pick the <code>.csv</code> the
          search saved. Its fares, daylight hours and airports come across as they are; Systema only re-prices
          them against what your own trips have cost.
        </p>
        {#if error}<p role="alert" class="hint hint--warn">{error}</p>{/if}
        <textarea
          class="field plan-textarea"
          aria-label="Finder table"
          placeholder="City,Country,Out date,Back date,…"
          bind:value={text}
          oninput={() => (error = '')}></textarea>
        <div class="cluster">
          <button class="btn btn--primary" onclick={() => read(text)} disabled={!text.trim()}
            >Read the table</button
          >
          <label class="btn btn--ghost">
            Pick a .csv
            <input type="file" accept=".csv,text/csv" onchange={pickFile} hidden />
          </label>
        </div>
      {:else}
        <p class="hint">
          {parsed.length} trip{parsed.length === 1 ? '' : 's'} found. Tick the ones worth comparing —
          the rest are a search result, not a decision.
        </p>
        {#if error}<p role="alert" class="hint hint--warn">{error}</p>{/if}
        <div class="finder-rows">
          {#each parsed as row (row.option.id)}
            <label class="finder-row" class:finder-row--on={picked.includes(row.option.id)}>
              <input
                type="checkbox"
                checked={picked.includes(row.option.id)}
                onchange={() => toggle(row.option.id)}
              />
              <span class="finder-main">
                <span class="finder-city">{row.city}</span>
                <span class="finder-meta">
                  {optionDates(row.option)} · {optionRoute(row.option)}
                  {#if row.option.finderPP != null}· £{Math.round(row.option.finderPP)} each{/if}
                  {#if row.option.usableH != null}· {row.option.usableH} h daylight{/if}
                </span>
              </span>
            </label>
          {/each}
        </div>
        <div class="cluster">
          <button class="btn btn--ghost btn--sm" onclick={() => (parsed = null)}
            >Back to the text</button
          >
        </div>
      {/if}
    </div>
  </div>
</dialog>

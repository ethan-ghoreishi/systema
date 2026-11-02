<script lang="ts">
  import { onMount } from 'svelte';
  import {
    FINDER_DEST_TRANSFER_PP,
    FINDER_HOTEL_PER_NIGHT,
    OptionParseError,
    optionDates,
    optionLeg,
    parseFinderConfig,
    parseFinderCsv,
    pounds,
    type FinderAssumptions,
    type ParsedRow,
  } from '../lib/options';
  import { addFinderRows } from '../lib/opportunities';
  import { DEFAULT_PARTY_SIZE } from '../lib/trips';

  /**
   * Taking a search straight from the Cheap-Trip Finder: pick the files the
   * search saved, or paste the table. Nothing is retyped, and nothing is
   * imported without being chosen — a whole search is a hundred rows, and a
   * hundred destinations under consideration is a backlog, not a decision.
   *
   * The search saves its results beside a `.config.json` holding what it priced
   * for. Taking both means a re-priced figure is measured against that run
   * rather than against numbers copied from the finder's source, which drift
   * the moment its defaults change. Without it the usual allowances are used,
   * and said out loud rather than assumed quietly.
   */
  let { onClose, onDone }: { onClose: () => void; onDone: (message: string) => void } = $props();

  let dialogEl: HTMLDialogElement;
  let text = $state('');
  let error = $state('');
  let saving = $state(false);
  let parsed = $state<ParsedRow[] | null>(null);
  let skipped = $state(0);
  let assumptions = $state<FinderAssumptions | null>(null);
  let picked = $state<string[]>([]);
  onMount(() => dialogEl.showModal());

  // Small searches are all worth a look; a big one starts with nothing ticked.
  const AUTO_PICK_MAX = 8;

  function read(source: string) {
    error = '';
    try {
      const search = parseFinderCsv(source);
      parsed = search.rows;
      skipped = search.skipped;
      picked = search.rows.length <= AUTO_PICK_MAX ? search.rows.map((r) => r.option.id) : [];
    } catch (err) {
      parsed = null;
      error = err instanceof OptionParseError ? err.message : `Could not read that: ${String(err)}`;
    }
  }

  async function pickFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    const config = files.find((f) => /\.json$/i.test(f.name));
    if (config) assumptions = parseFinderConfig(await config.text());
    // A search saves its results, its price map and its settings side by side,
    // and picking all three is the obvious thing to do. The results are
    // whichever table reads as trips, so each is tried rather than trusting the
    // order the files arrive in — the price map last, since it never is.
    const tables = files
      .filter((f) => !/\.json$/i.test(f.name))
      .sort(
        (a, b) =>
          Number(/_price_map\.csv$/i.test(a.name)) - Number(/_price_map\.csv$/i.test(b.name)),
      );
    error = '';
    for (const f of tables) {
      text = await f.text();
      read(text);
      if (parsed) break;
    }
    if (!tables.length) error = 'That is the search’s settings on its own. Pick its .csv as well.';
    input.value = '';
  }

  function toggle(id: string) {
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
  }

  const chosen = $derived((parsed ?? []).filter((r) => picked.includes(r.option.id)));
  const cityCount = $derived(
    new Set(chosen.map((r) => `${r.city.toLowerCase()}|${r.country?.toLowerCase() ?? ''}`)).size,
  );

  const priced = $derived({
    travellers: assumptions?.travellers ?? DEFAULT_PARTY_SIZE,
    dest: assumptions?.destTransferPP ?? FINDER_DEST_TRANSFER_PP,
    hotel: assumptions?.hotelPerNight ?? FINDER_HOTEL_PER_NIGHT,
  });

  async function save() {
    if (!chosen.length) return;
    saving = true;
    error = '';
    try {
      // Out of Svelte's reactive proxies before IndexedDB sees them: a proxy
      // cannot be structured-cloned, and the write would fail at the store.
      const assume = assumptions ? ($state.snapshot(assumptions) as FinderAssumptions) : null;
      const rows = ($state.snapshot(chosen) as ParsedRow[]).map((r) =>
        assume ? { ...r, option: { ...r.option, finderAssumptions: assume } } : r,
      );
      const r = await addFinderRows(rows);
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
          Pick what the search saved — its <code>.csv</code> and, beside it, its
          <code>.config.json</code>. The settings file is what the search actually priced for, so
          taking both means nothing has to be assumed.
        </p>
        {#if error}<p role="alert" class="hint hint--warn">{error}</p>{/if}
        <label class="btn btn--primary">
          Pick the search files
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            multiple
            onchange={pickFiles}
            hidden
          />
        </label>
        <details class="opt-work">
          <summary class="section-title">Or paste the table</summary>
          <p class="hint">
            Header row and all — the line starting <code>City,Country,Out date…</code>. A pasted
            table brings no settings with it, so the usual allowances are used.
          </p>
          <textarea
            class="field plan-textarea"
            aria-label="Finder table"
            placeholder="City,Country,Out date,Back date,…"
            bind:value={text}
            oninput={() => (error = '')}></textarea>
          <button class="btn btn--ghost" onclick={() => read(text)} disabled={!text.trim()}
            >Read the table</button
          >
        </details>
      {:else}
        <p class="hint">
          {parsed.length} trip{parsed.length === 1 ? '' : 's'} found. Tick the ones worth comparing —
          the rest are a search result, not a decision.
        </p>
        {#if skipped}
          <p class="hint">
            {skipped} row{skipped === 1 ? '' : 's'} had no flights yet and {skipped === 1
              ? 'was'
              : 'were'} left out.
          </p>
        {/if}
        <p class="hint">
          {#if assumptions}
            Priced for {priced.travellers} travellers, {pounds(priced.dest)} a transfer and {pounds(
              priced.hotel,
            )} a hotel night — the search's own settings.
          {:else}
            No settings file came with this, so these read as priced for {priced.travellers}
            travellers, {pounds(priced.dest)} a transfer and {pounds(priced.hotel)} a hotel night. Pick
            the search's <code>.config.json</code> too if its run differed.
          {/if}
        </p>
        {#if error}<p role="alert" class="hint hint--warn">{error}</p>{/if}
        <div class="finder-rows">
          {#each parsed as row (row.option.id)}
            {@const o = row.option}
            <label class="finder-row" class:finder-row--on={picked.includes(o.id)}>
              <input
                type="checkbox"
                checked={picked.includes(o.id)}
                onchange={() => toggle(o.id)}
              />
              <span class="finder-main">
                <span class="finder-city"
                  >{row.city}{#if row.country}<small>, {row.country}</small>{/if}
                  <span class="finder-price"
                    >{#if o.finderPP != null}{pounds(Math.round(o.finderPP))} each{:else}fare only{/if}</span
                  ></span
                >
                <span class="finder-meta">{optionDates(o)}</span>
                <span class="finder-meta">Out {optionLeg(o, 'out')}</span>
                <span class="finder-meta">Back {optionLeg(o, 'back')}</span>
                <span class="finder-meta">
                  {#if o.usableH != null}{o.usableH} h daylight{/if}
                  {#if o.groundH != null}· {o.groundH} h on the ground{/if}
                  {#if o.overnight}· {o.overnight}{/if}
                  {#if row.status && row.status !== 'OK'}· {row.status}{/if}
                </span>
              </span>
            </label>
          {/each}
        </div>
        <div class="cluster">
          <button class="btn btn--ghost btn--sm" onclick={() => (parsed = null)}>Start again</button
          >
        </div>
      {/if}
    </div>
  </div>
</dialog>

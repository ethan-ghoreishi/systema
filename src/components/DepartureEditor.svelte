<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { DepartPlan } from '../lib/db';
  import { MODE_DEFAULTS, PREPARE_MIN } from '../lib/readiness';
  import { timeIn, tzLongName, wallToInstant } from '../lib/tz';

  /**
   * One departure's plan — how you leave a city (or home): the time, the hub,
   * how you get there and how much slack you want. Opened from the readiness
   * card or a leg in Edit trip; everything is optional, and the leave-by time
   * updates as you change it.
   */
  let {
    title,
    wall,
    tz,
    plan,
    fromHint = '',
    onSave,
    onClose,
  }: {
    title: string;
    wall: string;
    tz?: string;
    plan: DepartPlan;
    fromHint?: string;
    onSave: (wall: string, plan: DepartPlan) => Promise<void>;
    onClose: () => void;
  } = $props();

  let dialogEl: HTMLDialogElement;
  onMount(() => dialogEl.showModal());

  const init = untrack(() => ({ wall, plan: { ...plan } }));
  let at = $state(init.wall);
  let mode = $state(init.plan.mode ?? 'flight');
  let hub = $state(init.plan.hub ?? '');
  let terminal = $state(init.plan.terminal ?? '');
  let number = $state(init.plan.number ?? '');
  let ref = $state(init.plan.ref ?? '');
  let from = $state(init.plan.from ?? '');
  let transport = $state(init.plan.transport ?? '');
  let journey = $state(init.plan.journeyMin?.toString() ?? '');
  let buffer = $state(init.plan.bufferMin?.toString() ?? '');
  let contingency = $state(init.plan.contingencyMin?.toString() ?? '');
  let prepare = $state(init.plan.prepareMin?.toString() ?? '');
  let notes = $state(init.plan.notes ?? '');
  let error = $state('');
  let saving = $state(false);

  const modes = [
    ['flight', 'Flight'],
    ['train', 'Train'],
    ['bus', 'Coach'],
    ['ferry', 'Ferry'],
    ['other', 'Other'],
  ] as const;
  const transports = ['Walk', 'Metro', 'Bus', 'Airport bus', 'Train', 'Taxi'];
  const defaults = $derived(MODE_DEFAULTS[mode] ?? MODE_DEFAULTS.flight);

  const num = (v: string): number | undefined => {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  };

  const leaveBy = $derived.by(() => {
    const t = wallToInstant(at, tz);
    if (t == null) return '';
    const mins =
      (num(buffer) ?? defaults.bufferMin) +
      (num(journey) ?? defaults.journeyMin) +
      (num(contingency) ?? defaults.contingencyMin);
    return timeIn(t - mins * 60_000, tz);
  });

  async function save() {
    saving = true;
    error = '';
    const clean = (v: string) => v.trim() || undefined;
    const next: DepartPlan = {
      ...plan,
      mode,
      hub: clean(hub),
      terminal: clean(terminal),
      number: clean(number),
      ref: clean(ref),
      from: clean(from),
      transport: clean(transport),
      journeyMin: num(journey),
      bufferMin: num(buffer),
      contingencyMin: num(contingency),
      prepareMin: num(prepare),
      notes: clean(notes),
    };
    // Drop unset keys so the stored plan stays small.
    for (const k of Object.keys(next) as (keyof DepartPlan)[])
      if (next[k] === undefined) delete next[k];
    try {
      await onSave(at, next);
      dialogEl.close();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
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
      <h2 class="modal-title">{title}</h2>
      <button class="btn btn--primary btn--sm" onclick={save} disabled={saving}>Save</button>
    </header>

    <div class="modal-body">
      {#if error}<p role="alert" class="hint hint--warn">{error}</p>{/if}

      <div class="chips" role="group" aria-label="How you travel">
        {#each modes as [v, label] (v)}
          <button class="chip" class:chip--on={mode === v} onclick={() => (mode = v)}
            >{label}</button
          >
        {/each}
      </div>

      <label class="label" for="dep-at">Departs</label>
      <input id="dep-at" class="field" type="datetime-local" bind:value={at} />
      {#if tz}<p class="hint">{tzLongName(tz)} ({tz})</p>{/if}

      <div class="dep-grid">
        <div>
          <label class="label" for="dep-hub"
            >{mode === 'flight' ? 'Airport' : 'Station / stop'}</label
          >
          <input
            id="dep-hub"
            class="field"
            placeholder={mode === 'flight' ? 'e.g. BLQ' : 'e.g. Bologna Centrale'}
            autocapitalize="characters"
            bind:value={hub}
          />
        </div>
        <div>
          <label class="label" for="dep-terminal">Terminal</label>
          <input id="dep-terminal" class="field" placeholder="if known" bind:value={terminal} />
        </div>
        <div>
          <label class="label" for="dep-number"
            >{mode === 'flight' ? 'Flight no.' : 'Service no.'}</label
          >
          <input id="dep-number" class="field" placeholder="optional" bind:value={number} />
        </div>
        <div>
          <label class="label" for="dep-ref">Booking ref</label>
          <input id="dep-ref" class="field" placeholder="optional" bind:value={ref} />
        </div>
      </div>

      <span class="section-title">Getting there</span>
      <div>
        <label class="label" for="dep-from">Setting off from</label>
        <input
          id="dep-from"
          class="field"
          placeholder={fromHint || 'e.g. the hotel'}
          bind:value={from}
        />
      </div>
      <div>
        <label class="label" for="dep-transport">By</label>
        <div class="chips">
          {#each transports as t (t)}
            <button
              class="chip chip--sm"
              class:chip--on={transport === t}
              onclick={() => (transport = t)}>{t}</button
            >
          {/each}
        </div>
        <input
          id="dep-transport"
          class="field"
          placeholder="or name it: Marconi Express, Aerobús…"
          bind:value={transport}
        />
      </div>

      <div class="dep-grid">
        <div>
          <label class="label" for="dep-journey">Journey (min)</label>
          <input
            id="dep-journey"
            class="field"
            inputmode="numeric"
            placeholder={`${defaults.journeyMin} (assumed)`}
            bind:value={journey}
          />
        </div>
        <div>
          <label class="label" for="dep-buffer">Be there before (min)</label>
          <input
            id="dep-buffer"
            class="field"
            inputmode="numeric"
            placeholder={String(defaults.bufferMin)}
            bind:value={buffer}
          />
        </div>
        <div>
          <label class="label" for="dep-cont">Spare (min)</label>
          <input
            id="dep-cont"
            class="field"
            inputmode="numeric"
            placeholder={String(defaults.contingencyMin)}
            bind:value={contingency}
          />
        </div>
        <div>
          <label class="label" for="dep-prep">Get ready (min before)</label>
          <input
            id="dep-prep"
            class="field"
            inputmode="numeric"
            placeholder={String(PREPARE_MIN)}
            bind:value={prepare}
          />
        </div>
      </div>

      {#if leaveBy}
        <p class="hint hint--ok" role="status">Leave by {leaveBy}.</p>
      {/if}

      <div>
        <label class="label" for="dep-notes">Notes</label>
        <textarea
          id="dep-notes"
          class="field"
          rows="2"
          placeholder="Bag drop closes 40 min before; validate the ticket on board…"
          bind:value={notes}></textarea>
      </div>
    </div>
  </div>
</dialog>

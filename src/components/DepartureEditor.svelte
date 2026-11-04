<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { DepartPlan } from '../lib/db';
  import { MODE_DEFAULTS, PREPARE_MIN, planTiming } from '../lib/readiness';
  import { timeIn, tzLongName, wallToInstant } from '../lib/tz';

  /**
   * One departure's plan, in the two halves it really has: the service you are
   * catching, and how you get to it. They were one list of boxes before, which
   * is how a coach's booking reference ended up in the flight's — and the trip
   * then read as having a booked flight.
   *
   * The ride to the airport usually has a timetable. Given its times, leave-by
   * counts back from the coach rather than from an assumed journey length, and
   * the panel at the bottom shows the whole sum in words — including what the
   * "get ready" figure does and does not move.
   */
  let {
    title,
    wall,
    tz,
    plan,
    fromHint = '',
    only,
    onSave,
    onClose,
  }: {
    title: string;
    wall: string;
    tz?: string;
    plan: DepartPlan;
    fromHint?: string;
    /** 'transfer' = the ride only (getting home from the airport has no service of its own). */
    only?: 'transfer';
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
  let transferAt = $state(init.plan.transferAt ?? '');
  let transferArr = $state(init.plan.transferArr ?? '');
  let transferRef = $state(init.plan.transferRef ?? '');
  let payOnDay = $state(init.plan.payOnDay ?? false);
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
  const clean = (v: string) => v.trim() || undefined;

  const draft = $derived<DepartPlan>({
    ...plan,
    mode,
    hub: clean(hub),
    terminal: clean(terminal),
    number: clean(number),
    ref: clean(ref),
    from: clean(from),
    transport: clean(transport),
    transferAt: clean(transferAt),
    transferArr: clean(transferArr),
    transferRef: clean(transferRef),
    payOnDay: payOnDay || undefined,
    journeyMin: num(journey),
    bufferMin: num(buffer),
    contingencyMin: num(contingency),
    prepareMin: num(prepare),
    notes: clean(notes),
  });

  const timing = $derived.by(() => {
    const t = wallToInstant(at, tz);
    return t == null ? null : { t, ...planTiming(t, at, tz, draft, mode) };
  });
  const clock = (ms: number) => timeIn(ms, tz);

  // The sum in words. Which facts it rests on is the whole point: a booked
  // coach is a timetable, a journey nobody has timed is an allowance.
  const explain = $derived.by(() => {
    if (!timing) return [];
    const lines: string[] = [];
    if (timing.serviceAt)
      lines.push(
        `Leave by ${clock(timing.leaveBy)} — the ${clock(timing.serviceAt)} ${transport.trim().toLowerCase() || 'service'} with ${timing.contingencyMin} min to reach it.`,
      );
    else
      lines.push(
        `Leave by ${clock(timing.leaveBy)} = ${clock(timing.t)} departure − ${timing.bufferMin} min at ${hub.trim() || 'the airport'} − ${timing.journeyMin} min to get there${timing.assumed.includes('journey') ? ' (assumed)' : ''} − ${timing.contingencyMin} min spare.`,
      );
    lines.push(
      `Start getting ready at ${clock(timing.prepareAt)} — that is just the earlier nudge; it never moves leave-by.`,
    );
    return lines;
  });

  async function save() {
    saving = true;
    error = '';
    const next = { ...$state.snapshot(draft) } as DepartPlan;
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
  aria-labelledby="departure-title"
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
      <h2 class="modal-title" id="departure-title">{title}</h2>
      <button class="btn btn--primary btn--sm" onclick={save} disabled={saving}>Save</button>
    </header>

    <div class="modal-body">
      {#if error}<p role="alert" class="hint hint--warn">{error}</p>{/if}

      {#if only !== 'transfer'}
        <span class="section-title">What you are catching</span>
        <div class="chips" role="group" aria-label="How you travel">
          {#each modes as [v, label] (v)}
            <button class="chip" class:chip--on={mode === v} onclick={() => (mode = v)}
              >{label}</button
            >
          {/each}
        </div>

        <label class="label" for="dep-at">Departs</label>
        <input id="dep-at" class="field" type="datetime-local" bind:value={at} />
        {#if tz}<p class="hint">As printed on the ticket — {tzLongName(tz)}.</p>{/if}

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
            <label class="label" for="dep-ref"
              >{mode === 'flight' ? 'Flight booking ref' : 'Ticket booking ref'}</label
            >
            <input id="dep-ref" class="field" placeholder="optional" bind:value={ref} />
          </div>
        </div>
        <p class="hint">
          The {mode === 'flight' ? 'flight' : 'service'} and its transfer have separate references.
        </p>
      {/if}

      <span class="section-title"
        >{only === 'transfer' ? 'The journey' : `Getting to ${hub.trim() || 'the airport'}`}</span
      >
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
          <label class="label" for="dep-tat">It leaves at</label>
          <input id="dep-tat" class="field" type="time" bind:value={transferAt} />
        </div>
        <div>
          <label class="label" for="dep-tarr">…and arrives</label>
          <input id="dep-tarr" class="field" type="time" bind:value={transferArr} />
        </div>
      </div>
      {#if only !== 'transfer' && timing?.slackMin != null}
        <p
          class="hint"
          class:hint--warn={timing.slackMin < timing.bufferMin}
          role={timing.slackMin < timing.bufferMin ? 'alert' : undefined}
        >
          {timing.slackMin <= 0
            ? 'That arrives at or after the departure. Look for an earlier service.'
            : `Arrives ${timing.slackMin} min before departure${timing.slackMin < timing.bufferMin ? ', less than your arrival margin' : ''}.`}
        </p>
      {/if}
      <p class="hint">Use the transfer ticket's times. Leave-by counts back from its departure.</p>

      {#if !transferAt.trim() || !transferArr.trim()}
        <div>
          <label class="label" for="dep-journey">Or just how long it takes (min)</label>
          <input
            id="dep-journey"
            class="field"
            inputmode="numeric"
            placeholder={`${defaults.journeyMin} (assumed)`}
            bind:value={journey}
          />
        </div>
      {/if}

      <div class="dep-grid">
        <div>
          <label class="label" for="dep-tref">Transfer booking ref</label>
          <input id="dep-tref" class="field" placeholder="optional" bind:value={transferRef} />
        </div>
        {#if only !== 'transfer'}
          <div>
            <label class="label" for="dep-buffer">Arrive early (min)</label>
            <input
              id="dep-buffer"
              class="field"
              inputmode="numeric"
              placeholder={String(defaults.bufferMin)}
              bind:value={buffer}
            />
          </div>
        {/if}
      </div>
      <label class="switch">
        <input type="checkbox" bind:checked={payOnDay} />
        <span class="hint"> Pay on the day. Name the ride and add its times or duration. </span>
      </label>

      {#if only !== 'transfer'}
        <span class="section-title">Your own margins</span>
        <div class="dep-grid">
          <div>
            <label class="label" for="dep-cont">Spare, before leaving (min)</label>
            <input
              id="dep-cont"
              class="field"
              inputmode="numeric"
              placeholder={String(defaults.contingencyMin)}
              bind:value={contingency}
            />
          </div>
          <div>
            <label class="label" for="dep-prep">Start getting ready (min before)</label>
            <input
              id="dep-prep"
              class="field"
              inputmode="numeric"
              placeholder={String(PREPARE_MIN)}
              bind:value={prepare}
            />
          </div>
        </div>

        {#if explain.length}
          <div class="card card--inset" role="status">
            {#each explain as line, i (line)}
              <p class={i === 0 ? 'depart-title' : 'hint'}>{line}</p>
            {/each}
          </div>
        {/if}
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

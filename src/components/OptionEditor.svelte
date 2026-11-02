<script lang="ts">
  import { onMount } from 'svelte';
  import type { TripOption } from '../lib/db';
  import { newId } from '../lib/ids';
  import { blockers } from '../lib/options';
  import { todayIso } from '../lib/sheet';

  /**
   * A way of making the trip, written by hand — a Google Flights search is how
   * most research actually starts, and the finder is an accelerator, not the
   * only door in.
   *
   * Only facts are asked for: dates, airports, the clock at both ends, the
   * flight numbers and the fares. Nothing is worked out here — what it comes to
   * is added up from these against the ledger (options.ts), so a figure never
   * rests on something nobody typed.
   */
  let {
    option,
    onSave,
    onClose,
  }: {
    option?: TripOption;
    onSave: (o: TripOption) => Promise<void> | void;
    onClose: () => void;
  } = $props();

  let dialogEl: HTMLDialogElement;
  let saving = $state(false);
  let error = $state('');
  onMount(() => dialogEl.showModal());

  const legOf = (o: TripOption | undefined, which: 'out' | 'back') => {
    const route = (which === 'out' ? o?.outRoute : o?.backRoute) ?? [];
    return {
      from: route[0] ?? '',
      via: route.length > 2 ? route.slice(1, -1).join(' ') : '',
      to: route[route.length - 1] ?? '',
      dep: (which === 'out' ? o?.outDep : o?.backDep) ?? '',
      arr: (which === 'out' ? o?.outArr : o?.backArr) ?? '',
      nextDay: ((which === 'out' ? o?.outArrDay : o?.backArrDay) ?? 0) > 0,
      flights: (which === 'out' ? o?.outFlights : o?.backFlights) ?? '',
      fare: String((which === 'out' ? o?.outFarePP : o?.backFarePP) ?? ''),
    };
  };

  let outDate = $state(option?.outDate ?? todayIso());
  let backDate = $state(option?.backDate ?? option?.outDate ?? todayIso());
  let nights = $state(String(option?.paidNights ?? 0));
  let note = $state(option?.note ?? '');
  let out = $state(legOf(option, 'out'));
  let back = $state(legOf(option, 'back'));

  const code = (v: string) => v.trim().toUpperCase();
  const route = (leg: typeof out) =>
    [
      code(leg.from),
      ...leg.via
        .split(/[\s,→-]+/)
        .map(code)
        .filter(Boolean),
      code(leg.to),
    ].filter(Boolean);
  const money = (v: string) => {
    const n = Number(v.replace(/[£,\s]/g, ''));
    return v.trim() && Number.isFinite(n) ? n : undefined;
  };

  const built = $derived.by((): TripOption => {
    const paidNights = Number(nights);
    return {
      id: option?.id ?? newId(),
      source: 'manual',
      outDate,
      backDate: backDate || outDate,
      outRoute: route(out),
      backRoute: route(back),
      ...(out.dep ? { outDep: out.dep } : {}),
      ...(out.arr ? { outArr: out.arr } : {}),
      ...(back.dep ? { backDep: back.dep } : {}),
      ...(back.arr ? { backArr: back.arr } : {}),
      ...(out.nextDay ? { outArrDay: 1 } : {}),
      ...(back.nextDay ? { backArrDay: 1 } : {}),
      ...(out.flights.trim() ? { outFlights: out.flights.trim() } : {}),
      ...(back.flights.trim() ? { backFlights: back.flights.trim() } : {}),
      ...(money(out.fare) != null ? { outFarePP: money(out.fare) } : {}),
      ...(money(back.fare) != null ? { backFarePP: money(back.fare) } : {}),
      ...(Number.isFinite(paidNights) && paidNights > 0 ? { paidNights } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      // Fares typed today are fresh today; the staleness warning counts from here.
      ...(money(out.fare) != null || money(back.fare) != null
        ? { checked: `${todayIso()} 00:00` }
        : {}),
      ...(option?.finderAssumptions ? { finderAssumptions: option.finderAssumptions } : {}),
    };
  });

  const problems = $derived([
    ...blockers(built),
    ...(built.outRoute.length < 2 ? ['Say which airport you leave from and where you land.'] : []),
  ]);

  async function save() {
    if (problems.length) return;
    saving = true;
    error = '';
    try {
      await onSave($state.snapshot(built) as TripOption);
      dialogEl.close();
    } catch (err) {
      error = `Not saved: ${err instanceof Error ? err.message : String(err)}`;
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
      <h2 class="modal-title">{option ? 'Edit this option' : 'Add an option'}</h2>
      <button
        class="btn btn--primary btn--sm"
        onclick={save}
        disabled={saving || problems.length > 0}>Save</button
      >
    </header>
    <div class="modal-body">
      {#if error}<p role="alert" class="hint hint--warn">{error}</p>{/if}
      <p class="hint">
        Straight off a Google Flights search. Leave anything you do not know blank — it stays blank
        rather than being guessed at, and the comparison says so.
      </p>

      <label class="label" for="opt-out-date">Out on</label>
      <input id="opt-out-date" class="field" type="date" bind:value={outDate} />
      <label class="label" for="opt-back-date">Back on</label>
      <input id="opt-back-date" class="field" type="date" bind:value={backDate} />

      {#each [{ key: 'out', leg: out, title: 'The flight out' }, { key: 'back', leg: back, title: 'The flight home' }] as part (part.key)}
        <span class="section-title">{part.title}</span>
        <div class="opt-fields">
          <label class="label" for={`${part.key}-from`}>From</label>
          <input
            id={`${part.key}-from`}
            class="field"
            type="text"
            maxlength="3"
            placeholder="STN"
            bind:value={part.leg.from}
          />
          <label class="label" for={`${part.key}-to`}>To</label>
          <input
            id={`${part.key}-to`}
            class="field"
            type="text"
            maxlength="3"
            placeholder="FAO"
            bind:value={part.leg.to}
          />
          <label class="label" for={`${part.key}-dep`}>Departs</label>
          <input id={`${part.key}-dep`} class="field" type="time" bind:value={part.leg.dep} />
          <label class="label" for={`${part.key}-arr`}>Arrives</label>
          <input id={`${part.key}-arr`} class="field" type="time" bind:value={part.leg.arr} />
        </div>
        <label class="switch">
          <input type="checkbox" bind:checked={part.leg.nextDay} />
          <span class="hint">Lands the next day</span>
        </label>
        <label class="label" for={`${part.key}-via`}>Change of planes at (optional)</label>
        <input
          id={`${part.key}-via`}
          class="field"
          type="text"
          placeholder="BCN"
          bind:value={part.leg.via}
        />
        <label class="label" for={`${part.key}-flights`}>Flight number</label>
        <input
          id={`${part.key}-flights`}
          class="field"
          type="text"
          placeholder="Ryanair 5767"
          bind:value={part.leg.flights}
        />
        <label class="label" for={`${part.key}-fare`}>Fare, each (£)</label>
        <input
          id={`${part.key}-fare`}
          class="field"
          type="text"
          inputmode="decimal"
          bind:value={part.leg.fare}
        />
      {/each}

      <label class="label" for="opt-nights">Hotel nights to pay for</label>
      <input id="opt-nights" class="field" type="text" inputmode="numeric" bind:value={nights} />
      <label class="label" for="opt-note">Note</label>
      <input
        id="opt-note"
        class="field"
        type="text"
        placeholder="Cabin bag only"
        bind:value={note}
      />

      {#each problems as p (p)}
        <p class="hint hint--warn">{p}</p>
      {/each}
    </div>
  </div>
</dialog>

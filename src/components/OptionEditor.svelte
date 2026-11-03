<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { TripOption } from '../lib/db';
  import { newId } from '../lib/ids';
  import { blockers } from '../lib/options';
  import { ecbPublishes, getRate } from '../lib/fx';
  import { priceEntry } from '../lib/expenses';
  import { FARE_CURRENCIES } from '../lib/currencies';
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
   *
   * Two tickets bought separately are often sold in two different currencies,
   * so each fare carries its own. The comparison is in sterling, so each one is
   * converted at the day's rate (or by hand, for a currency the ECB does not
   * publish) — and what was really quoted is kept beside it.
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

  type Leg = {
    from: string;
    via: string;
    to: string;
    dep: string;
    arr: string;
    nextDay: boolean;
    flights: string;
    fare: string;
    ccy: string;
    /** The £ equivalent, typed by hand when no rate can be fetched. */
    gbp: string;
  };

  const legOf = (o: TripOption | undefined, which: 'out' | 'back'): Leg => {
    const route = (which === 'out' ? o?.outRoute : o?.backRoute) ?? [];
    const ccy = (which === 'out' ? o?.outFareCcy : o?.backFareCcy) ?? 'GBP';
    const local = which === 'out' ? o?.outFareLocal : o?.backFareLocal;
    const pounds = which === 'out' ? o?.outFarePP : o?.backFarePP;
    return {
      from: route[0] ?? '',
      via: route.length > 2 ? route.slice(1, -1).join(' ') : '',
      to: route[route.length - 1] ?? '',
      dep: (which === 'out' ? o?.outDep : o?.backDep) ?? '',
      arr: (which === 'out' ? o?.outArr : o?.backArr) ?? '',
      nextDay: ((which === 'out' ? o?.outArrDay : o?.backArrDay) ?? 0) > 0,
      flights: (which === 'out' ? o?.outFlights : o?.backFlights) ?? '',
      fare: String(local ?? pounds ?? ''),
      ccy,
      gbp: ccy !== 'GBP' && pounds != null ? String(pounds) : '',
    };
  };

  // The dialog is remounted for each option it opens, so every field below is
  // deliberately seeded once from the option as it was (untrack says so, and
  // keeps the compiler from suggesting a derived).
  const isNew = untrack(() => !option);
  // A fare you can still book is never for today: a fortnight out is the
  // nearest date a search is normally run for, and it is the one date nobody
  // has to correct before typing the real one.
  const soon = (days: number) =>
    new Date(Date.parse(`${todayIso()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const init = untrack(() => ({
    outDate: option?.outDate ?? soon(14),
    backDate: option?.backDate ?? option?.outDate ?? soon(16),
    nights: String(option?.paidNights ?? 1),
    // Where the night goes, when the dates span one. A row that says nothing
    // about it becomes a trip that sleeps nowhere, which is only right for the
    // trips that really do.
    sleep: (/airport sleep/i.test(option?.overnight ?? '')
      ? 'airport'
      : (option?.paidNights ?? 0) > 0
        ? 'hotel'
        : 'none') as 'none' | 'airport' | 'hotel',
    note: option?.note ?? '',
    out: legOf(option, 'out'),
    back: legOf(option, 'back'),
  }));
  let outDate = $state(init.outDate);
  let backDate = $state(init.backDate);
  let nights = $state(init.nights);
  let sleep = $state(init.sleep);
  let note = $state(init.note);
  let out = $state(init.out);
  let back = $state(init.back);

  // Coming back before you set off is refused on save, which is no use while
  // the picker will still offer the day: the return can never be earlier than
  // the outbound, and moving the outbound past it takes it along.
  $effect(() => {
    if (backDate && backDate < outDate) backDate = outDate;
  });

  const code = (v: string) => v.trim().toUpperCase();
  const route = (leg: Leg) =>
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
    return v.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  // The day's rate for each fare currency, so the £ the comparison needs is
  // not something to work out by hand. A currency the ECB never publishes
  // (the dinar, the dirham) asks for the £ instead of promising a rate.
  let rates = $state<Record<string, number | null>>({ GBP: 1 });
  $effect(() => {
    for (const ccy of new Set([out.ccy, back.ccy])) {
      if (ccy === 'GBP' || ccy in rates || !ecbPublishes(ccy)) continue;
      rates = { ...rates, [ccy]: null };
      void getRate(ccy).then((r) => (rates = { ...rates, [ccy]: r?.rate ?? null }));
    }
  });
  const rateFor = (ccy: string) => (ccy === 'GBP' ? 1 : (rates[ccy] ?? null));

  const needsPounds = (leg: Leg) =>
    leg.ccy !== 'GBP' && money(leg.fare) != null && rateFor(leg.ccy) == null;

  /**
   * The fare in sterling, decided the same way a saved expense's £ is
   * (expenses.ts): the amount itself when it is already pounds, the £ typed by
   * hand where one was asked for, otherwise the day's rate — and the £ already
   * recorded while the fare has not moved, so re-opening an option and saving
   * it cannot quietly re-price it at today's rate (and so bump when the fare
   * was last checked, or throw away the search's own total).
   *
   * The typed £ counts only while its field is on screen. A hidden field that
   * still decides the figure is exactly the bug this fixes in the ledger.
   */
  const RECORDED_ON = '2000-01-01';
  function farePounds(leg: Leg, which: 'out' | 'back'): number | undefined {
    const local = money(leg.fare);
    if (local == null) return undefined;
    if (leg.ccy === 'GBP') return local;
    const was = {
      local: which === 'out' ? option?.outFareLocal : option?.backFareLocal,
      ccy: which === 'out' ? option?.outFareCcy : option?.backFareCcy,
      pounds: which === 'out' ? option?.outFarePP : option?.backFarePP,
    };
    const priced = priceEntry({
      amount: local,
      currency: leg.ccy,
      date: RECORDED_ON,
      overrideGBP: needsPounds(leg) ? (money(leg.gbp) ?? null) : null,
      rate: rateFor(leg.ccy),
      ...(was.pounds != null && was.local != null && was.ccy
        ? {
            recorded: {
              amount: was.local,
              amountGBP: was.pounds,
              currency: was.ccy,
              date: RECORDED_ON,
              fxRate: null,
            },
          }
        : {}),
    });
    return priced.fxPending ? undefined : priced.amountGBP;
  }

  const spansNight = $derived(!!backDate && backDate > outDate);

  const fareFields = (leg: Leg, which: 'out' | 'back') => {
    const local = money(leg.fare);
    const gbp = farePounds(leg, which);
    const key = which === 'out' ? 'outFare' : 'backFare';
    return {
      ...(gbp != null ? { [`${key}PP`]: gbp } : {}),
      ...(local != null && leg.ccy !== 'GBP'
        ? { [`${key}Local`]: local, [`${key}Ccy`]: leg.ccy }
        : {}),
    };
  };

  const built = $derived.by((): TripOption => {
    const paidNights = spansNight && sleep === 'hotel' ? Number(nights) : 0;
    const night =
      spansNight && sleep === 'hotel' && Number.isFinite(paidNights) && paidNights > 0
        ? { paidNights, overnight: `Hotel ×${paidNights}` }
        : spansNight && sleep === 'airport'
          ? { paidNights: 0, overnight: 'Airport sleep' }
          : { paidNights: 0, overnight: undefined };
    const fares = { ...fareFields(out, 'out'), ...fareFields(back, 'back') };
    // Everything the editor does not ask about belongs to the option still:
    // the finder's own figures, its links, its ranking inputs. Rebuilding the
    // record from the fields on screen is how an imported row quietly became a
    // hand-written one with no fare history and no Google Flights link.
    const next: TripOption = {
      ...option,
      id: option?.id ?? newId(),
      ...(isNew ? { source: 'manual' as const } : {}),
      outDate,
      backDate: backDate || outDate,
      outRoute: route(out),
      backRoute: route(back),
      outDep: out.dep || undefined,
      outArr: out.arr || undefined,
      backDep: back.dep || undefined,
      backArr: back.arr || undefined,
      outArrDay: out.nextDay ? 1 : undefined,
      backArrDay: back.nextDay ? 1 : undefined,
      outFlights: out.flights.trim() || undefined,
      backFlights: back.flights.trim() || undefined,
      outFarePP: undefined,
      outFareLocal: undefined,
      outFareCcy: undefined,
      backFarePP: undefined,
      backFareLocal: undefined,
      backFareCcy: undefined,
      ...fares,
      ...night,
      note: note.trim() || undefined,
    };
    // A fare that has actually changed was checked today; one left alone keeps
    // the date it was checked, so a fortnight-old price still says so.
    const fareMoved =
      next.outFarePP !== option?.outFarePP ||
      next.backFarePP !== option?.backFarePP ||
      next.outFareLocal !== option?.outFareLocal ||
      next.backFareLocal !== option?.backFareLocal;
    if (fareMoved && (next.outFarePP != null || next.backFarePP != null))
      next.checked = `${todayIso()} 00:00`;
    // A fare you have changed yourself is no longer the one the search totalled
    // up, so its true cost cannot stand: the figure is added up from these
    // parts instead. Everything the fare does not touch — the daylight hours,
    // the links to re-check it, which run it came from — stays.
    if (fareMoved && option?.finderPP != null) {
      delete next.finderPP;
      next.source = 'manual';
    }
    for (const k of Object.keys(next) as (keyof TripOption)[])
      if (next[k] === undefined) delete next[k];
    return next;
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
        rather than being guessed at.
      </p>

      <div class="opt-fields">
        <div>
          <label class="label" for="opt-out-date">Out on</label>
          <input
            id="opt-out-date"
            class="field"
            type="date"
            min={isNew ? todayIso() : undefined}
            bind:value={outDate}
          />
        </div>
        <div>
          <label class="label" for="opt-back-date">Back on</label>
          <input id="opt-back-date" class="field" type="date" min={outDate} bind:value={backDate} />
        </div>
      </div>

      {#each [{ key: 'out', leg: out, title: 'The flight out', from: 'STN', to: 'FAO' }, { key: 'back', leg: back, title: 'The flight home', from: 'FAO', to: 'STN' }] as part (part.key)}
        <span class="section-title">{part.title}</span>
        <div class="opt-fields">
          <div>
            <label class="label" for={`${part.key}-from`}>From</label>
            <input
              id={`${part.key}-from`}
              class="field"
              type="text"
              maxlength="3"
              autocapitalize="characters"
              placeholder={part.from}
              bind:value={part.leg.from}
            />
          </div>
          <div>
            <label class="label" for={`${part.key}-to`}>To</label>
            <input
              id={`${part.key}-to`}
              class="field"
              type="text"
              maxlength="3"
              autocapitalize="characters"
              placeholder={part.to}
              bind:value={part.leg.to}
            />
          </div>
          <div>
            <label class="label" for={`${part.key}-dep`}
              >Departs · {code(part.leg.from) || 'local'} time</label
            >
            <input id={`${part.key}-dep`} class="field" type="time" bind:value={part.leg.dep} />
          </div>
          <div>
            <label class="label" for={`${part.key}-arr`}
              >Arrives · {code(part.leg.to) || 'local'} time</label
            >
            <input id={`${part.key}-arr`} class="field" type="time" bind:value={part.leg.arr} />
          </div>
        </div>
        <p class="hint">Both clocks as the ticket prints them, each in its own airport's time.</p>
        <label class="switch">
          <input type="checkbox" bind:checked={part.leg.nextDay} />
          <span class="hint">Lands the next day</span>
        </label>

        <div class="opt-fields">
          <div>
            <label class="label" for={`${part.key}-fare`}>Fare, each</label>
            <input
              id={`${part.key}-fare`}
              class="field"
              type="text"
              inputmode="decimal"
              bind:value={part.leg.fare}
            />
          </div>
          <div>
            <label class="label" for={`${part.key}-ccy`}>Paid in</label>
            <select id={`${part.key}-ccy`} class="field" bind:value={part.leg.ccy}>
              {#each FARE_CURRENCIES as c (c)}
                <option value={c}>{c}</option>
              {/each}
            </select>
          </div>
        </div>
        {#if needsPounds(part.leg)}
          <label class="label" for={`${part.key}-gbp`}>…which is, in £ each</label>
          <input
            id={`${part.key}-gbp`}
            class="field"
            type="text"
            inputmode="decimal"
            bind:value={part.leg.gbp}
          />
          <p class="hint">
            {ecbPublishes(part.leg.ccy)
              ? `No ${part.leg.ccy} rate to hand right now — put the £ in yourself and the comparison can use it.`
              : `No ${part.leg.ccy} rate is published, so the £ cannot be worked out — put in roughly what it comes to.`}
          </p>
        {:else if part.leg.ccy !== 'GBP' && farePounds(part.leg, part.key as 'out' | 'back') != null}
          <p class="hint">
            About £{farePounds(part.leg, part.key as 'out' | 'back')} each in sterling.
          </p>
        {/if}

        <details class="opt-work">
          <summary>More about this flight</summary>
          <label class="label" for={`${part.key}-via`}>Change of planes at</label>
          <input
            id={`${part.key}-via`}
            class="field"
            type="text"
            autocapitalize="characters"
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
        </details>
      {/each}

      {#if spansNight}
        <label class="label" for="opt-sleep">Where you sleep</label>
        <select id="opt-sleep" class="field" bind:value={sleep}>
          <option value="none">Nowhere — travelling through</option>
          <option value="airport">At the airport</option>
          <option value="hotel">A hotel</option>
        </select>
        {#if sleep === 'hotel'}
          <label class="label" for="opt-nights">Nights to pay for</label>
          <input
            id="opt-nights"
            class="field"
            type="text"
            inputmode="numeric"
            bind:value={nights}
          />
        {/if}
      {/if}
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

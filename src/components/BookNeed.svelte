<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db, type Trip } from '../lib/db';
  import { bookNeed, settles, STATE_WORD, type Need, type NeedState } from '../lib/needs';
  import { priceEntry } from '../lib/expenses';
  import { ecbPublishes, getRate } from '../lib/fx';
  import { FARE_CURRENCIES } from '../lib/currencies';
  import { formatGBP } from '../lib/money';
  import { todayIso } from '../lib/sheet';

  /**
   * Recording a booking: the money and the travel detail in one go.
   *
   * This is the point of "a booking is structured state". Booking the £22
   * coach writes the fare into the ledger *and* the mode, the times and the
   * reference onto the journey, against the same requirement — so the readiness
   * card stops guessing, the countdown counts back from the real service, and
   * £22 is never typed into Expenses a second time.
   *
   * The amount starts at whatever the trip was quoted, where a chosen option
   * said: a quote is not a payment, so it has been sitting beside the row
   * rather than in it, waiting to be confirmed or corrected.
   */
  let {
    trip,
    need,
    onClose,
    onDone,
  }: { trip: Trip; need: Need; onClose: () => void; onDone: (message: string) => void } = $props();

  let dialogEl: HTMLDialogElement;
  onMount(() => dialogEl.showModal());

  // The row this need already has, for the quote and for anything recorded.
  const rowQ = liveQuery(async () =>
    need.book
      ? ((await db.expenses.where('tripId').equals(trip.id).toArray()).find(
          (e) => e.need === need.key,
        ) ?? null)
      : null,
  );
  const row = $derived($rowQ ?? null);
  const quote = $derived(row?.quote?.amountGBP ?? null);

  let amount = $state('');
  let currency = $state('GBP');
  let gbp = $state('');
  let ref = $state('');
  let transport = $state('');
  let journeyMin = $state('');
  let transferAt = $state('');
  let transferArr = $state('');
  let payOnDay = $state(false);
  let place = $state('');
  let bothWays = $state(false);
  let date = $state(todayIso());
  let error = $state('');
  let saving = $state(false);
  let prefilled = $state(false);

  // Offer the quoted figure once, when it arrives: typed over freely, and never
  // re-imposed on something already entered.
  $effect(() => {
    if (prefilled || quote == null || untrack(() => amount.trim())) return;
    prefilled = true;
    amount = String(quote);
  });

  let rate = $state<number | null>(1);
  $effect(() => {
    const c = currency;
    if (c === 'GBP') {
      rate = 1;
      return;
    }
    rate = null;
    let cancelled = false;
    if (ecbPublishes(c)) void getRate(c).then((r) => !cancelled && (rate = r?.rate ?? null));
    return () => {
      cancelled = true;
    };
  });

  const num = (v: string) => {
    const n = Number(v.replace(/[£,\s]/g, ''));
    return v.trim() && Number.isFinite(n) && n > 0 ? n : 0;
  };
  const money = $derived(num(amount));
  const isGBP = $derived(currency === 'GBP');
  const needsPounds = $derived(!isGBP && money > 0 && rate == null);
  // A dinar never prices itself, however long you wait online, so a booking in
  // one with no £ would sit in the ledger reading as nothing paid while the
  // sheet says it was. Ask for the £ instead of saving a figure of zero.
  const mustTypePounds = $derived(needsPounds && !ecbPublishes(currency) && num(gbp) === 0);
  const priced = $derived(
    priceEntry({
      amount: money,
      currency,
      date,
      overrideGBP: num(gbp) || null,
      rate,
    }),
  );
  const spec = $derived(need.book);

  // A free reservation has nothing to type: saving it *is* the record.
  const valid = $derived(
    !mustTypePounds &&
      (need.kind === 'book' ||
        money > 0 ||
        !!ref.trim() ||
        !!transport.trim() ||
        !!place.trim() ||
        !!journeyMin.trim() ||
        !!transferAt.trim() ||
        payOnDay),
  );

  // What this will actually leave behind — so the list never reports a thing as
  // sorted that the trip still reads as outstanding. A hotel with a name and no
  // reference is a choice; a ride you buy on the day is enough, once you say so.
  const willBe = $derived<NeedState>(
    priced.amountGBP > 0 || priced.fxPending
      ? 'paid'
      : ref.trim() || need.kind === 'book'
        ? 'booked'
        : transport.trim() || journeyMin.trim() || transferAt.trim() || place.trim() || payOnDay
          ? 'planned'
          : 'open',
  );

  async function save() {
    if (!valid) return;
    saving = true;
    error = '';
    try {
      const mins = Number(journeyMin);
      const { expenseId } = await bookNeed(trip, need, {
        amountGBP: priced.amountGBP,
        ...(isGBP
          ? {}
          : {
              amountLocal: priced.amountLocal,
              currency: priced.currency,
              fxRate: priced.fxRate,
              gbpManual: priced.gbpManual,
              fxPending: priced.fxPending,
            }),
        ref: ref.trim() || undefined,
        transport: transport.trim() || undefined,
        journeyMin: journeyMin.trim() && Number.isFinite(mins) && mins >= 0 ? mins : undefined,
        transferAt: transferAt.trim() || undefined,
        transferArr: transferArr.trim() || undefined,
        payOnDay: payOnDay || undefined,
        place: place.trim() || undefined,
        bothWays,
        date,
      });
      const word = STATE_WORD[willBe];
      onDone(
        expenseId
          ? `${need.label}: ${word}, and ${formatGBP(priced.amountGBP)} is in Expenses — no need to enter it again.`
          : settles(need.kind, willBe, payOnDay)
            ? `${need.label}: ${word}.`
            : `${need.label}: ${word} — still on the list until it is.`,
      );
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
      <h2 class="modal-title">{need.label}</h2>
      <button class="btn btn--primary btn--sm" onclick={save} disabled={saving || !valid}
        >Save</button
      >
    </header>
    <div class="modal-body">
      {#if error}<p role="alert" class="hint hint--warn">{error}</p>{/if}

      <div class="dep-grid">
        <div>
          <label class="label" for="book-amount">What it cost, for everyone</label>
          <input
            id="book-amount"
            class="field"
            type="text"
            inputmode="decimal"
            bind:value={amount}
          />
        </div>
        <div>
          <label class="label" for="book-ccy">Paid in</label>
          <select id="book-ccy" class="field" bind:value={currency}>
            {#each FARE_CURRENCIES as c (c)}
              <option value={c}>{c}</option>
            {/each}
          </select>
        </div>
      </div>
      {#if needsPounds}
        <label class="label" for="book-gbp">…which is, in £</label>
        <input id="book-gbp" class="field" type="text" inputmode="decimal" bind:value={gbp} />
        <p class="hint" class:hint--warn={mustTypePounds}>
          {ecbPublishes(currency)
            ? `No ${currency} rate to hand — it prices itself when you are next online, or put the £ in now.`
            : `No ${currency} rate is published and none is coming, so the £ from your statement is needed before this can be saved.`}
        </p>
      {:else if !isGBP && money > 0}
        <p class="hint">
          About {formatGBP(priced.amountGBP)} at today's rate — kept as the £ figure.
        </p>
      {/if}
      <p class="hint">
        {#if quote != null}Quoted {formatGBP(quote)} when this trip was chosen — correct it to what you
          actually paid.{/if}
        Goes into Expenses as {spec?.subcategory}{spec?.shared ? ', trip-wide' : ''} — leave it blank
        if you have not paid yet.
      </p>

      {#if spec?.asksPlace}
        <label class="label" for="book-place">Where you are staying</label>
        <input id="book-place" class="field" type="text" bind:value={place} />
        <p class="hint">A name is a choice. It counts as booked once there is a reference below.</p>
      {/if}

      {#if spec?.asksTransport}
        <label class="label" for="book-transport">How you get there</label>
        <input
          id="book-transport"
          class="field"
          type="text"
          placeholder="National Express"
          bind:value={transport}
        />
        <div class="dep-grid">
          <div>
            <label class="label" for="book-tat">It leaves at</label>
            <input id="book-tat" class="field" type="time" bind:value={transferAt} />
          </div>
          <div>
            <label class="label" for="book-tarr">…and arrives</label>
            <input id="book-tarr" class="field" type="time" bind:value={transferArr} />
          </div>
        </div>
        <p class="hint">
          Straight off the ticket. Leave-by then counts back from the service itself instead of
          guessing how long the journey takes.
        </p>
        {#if !transferAt.trim()}
          <label class="label" for="book-journey">Or how long it takes (minutes)</label>
          <input
            id="book-journey"
            class="field"
            type="text"
            inputmode="numeric"
            placeholder="75"
            bind:value={journeyMin}
          />
        {/if}
        <label class="switch">
          <input type="checkbox" bind:checked={bothWays} />
          <span class="hint">
            The same ticket covers the way back. Both journeys keep their own line — they happen at
            different hours — but this one purchase settles both.
          </span>
        </label>
        <label class="switch">
          <input type="checkbox" bind:checked={payOnDay} />
          <span class="hint">
            Bought on the day, at the machine or on board. Without this, knowing how you are
            travelling still leaves the ride unsorted.
          </span>
        </label>
      {/if}

      <label class="label" for="book-ref">Booking reference</label>
      <input id="book-ref" class="field" type="text" bind:value={ref} />
      {#if need.kind === 'book'}
        <p class="hint">Saving this records the reservation, whether or not it cost anything.</p>
      {:else if spec?.asksTransport}
        <p class="hint">
          The reference for this ride — not the flight's. Leave it blank for a fare you pay on the
          day.
        </p>
      {/if}

      <label class="label" for="book-date">Paid on</label>
      <input id="book-date" class="field" type="date" bind:value={date} />
    </div>
  </div>
</dialog>

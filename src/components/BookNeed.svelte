<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db, type Expense, type Trip } from '../lib/db';
  import { same } from '../lib/sync';
  import { quoteMatchesParty } from '../lib/quotes';
  import {
    bookNeed,
    bookingDetails,
    expenseForNeed,
    tripNeeds,
    STATE_WORD,
    type Need,
  } from '../lib/needs';
  import { priceEntry } from '../lib/expenses';
  import { ecbPublishes, getRate } from '../lib/fx';
  import { FARE_CURRENCIES } from '../lib/currencies';
  import { formatGBP, parseMoney, MONEY_HINT } from '../lib/money';
  import { isManualGBP } from '../lib/expense-defaults';
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
  const contextQ = liveQuery(async () => {
    const current = await db.trips.get(trip.id);
    if (!current) return null;
    const cities = await db.cities.where('tripId').equals(trip.id).toArray();
    const stops = await db.stops.where('tripId').equals(trip.id).toArray();
    const expenses = await db.expenses.where('tripId').equals(trip.id).toArray();
    const currentNeed = tripNeeds(current, cities, expenses, stops).find((n) => n.key === need.key);
    return currentNeed?.book
      ? {
          ...bookingDetails(current, currentNeed, cities, stops, expenses),
          row: expenseForNeed(expenses, currentNeed),
          partySize: current.partySize,
        }
      : null;
  });
  const context = $derived($contextQ);
  const row = $derived(context?.row);
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
  let quotedAmount = $state(false);
  let recordPayment = $state(false);
  let quotedUnpaid = $state(false);
  // A pound figure of your own is in play, so its field stays on screen: an
  // override that decides the row from behind a condition is this app's
  // recurring bug (see expenses.ts priceEntry).
  let gbpTouched = $state(false);
  // The row this sheet was filled from held no payment.
  let wasUnpaid = $state(false);
  let openedRow = $state<Expense | null>(null);
  let openedPartySize = $state(0);
  const usableQuote = $derived(
    quoteMatchesParty(openedRow?.quote, context?.partySize ?? trip.partySize),
  );
  const recordingPayment = $derived(!quotedUnpaid || recordPayment);
  function changeCurrency(e: Event) {
    currency = (e.currentTarget as HTMLSelectElement).value;
    // A quoted pound is not an amount in the newly selected currency.
    if (quotedAmount) amount = '';
    quotedAmount = false;
    recordPayment = false;
    gbp = '';
    gbpTouched = false;
    prefilled = true;
  }

  // Snapshot the stored journey and payment once; live updates never replace typing.
  $effect(() => {
    if (!context || untrack(() => prefilled)) return;
    prefilled = true;
    const { plan, row } = context;
    openedRow = row ? structuredClone(row) : null;
    openedPartySize = context.partySize;
    quotedUnpaid = !!row?.skeleton && quote != null;
    wasUnpaid = !row || !!row.skeleton;
    ref = context.ref ?? '';
    place = context.place ?? '';
    transport = plan.transport ?? '';
    journeyMin = plan.journeyMin?.toString() ?? '';
    transferAt = plan.transferAt ?? '';
    transferArr = plan.transferArr ?? '';
    payOnDay = plan.payOnDay ?? false;
    bothWays = context.bothWays;
    if (row && !row.skeleton) {
      currency = row.currency || 'GBP';
      amount = String(currency === 'GBP' ? row.amountGBP : row.amountLocal);
      if (currency !== 'GBP' && isManualGBP(row)) {
        gbp = String(row.amountGBP);
        gbpTouched = true;
      }
      date = row.date || todayIso();
    } else if (quote != null && usableQuote) {
      amount = String(quote);
      quotedAmount = true;
    }
  });

  let rate = $state<number | null>(1);
  $effect(() => {
    if (quotedAmount && !usableQuote) {
      amount = '';
      quotedAmount = false;
      recordPayment = false;
    }
  });
  $effect(() => {
    const c = currency;
    const paidOn = date;
    if (c === 'GBP') {
      rate = 1;
      return;
    }
    rate = null;
    let cancelled = false;
    if (ecbPublishes(c))
      void getRate(c, paidOn).then((r) => !cancelled && (rate = r?.rate ?? null));
    return () => {
      cancelled = true;
    };
  });

  const num = (v: string) => parseMoney(v) ?? 0;
  const money = $derived(recordingPayment ? num(amount) : 0);
  const invalidAmount = $derived(!!amount.trim() && parseMoney(amount) == null);
  const isGBP = $derived(currency === 'GBP');
  const needsPounds = $derived(!isGBP && money > 0 && rate == null);
  // Never hidden while it decides the figure: a hand-typed £ survives a rate
  // arriving, so the sheet keeps it where it can be seen and changed.
  const showPounds = $derived(!isGBP && money > 0 && (rate == null || gbpTouched));
  const invalidPounds = $derived(showPounds && !!gbp.trim() && !(parseMoney(gbp)! > 0));
  // A payment for this arrived after the sheet was filled (another device, or
  // another tab). What is on screen was typed against a row that had none.
  const paidElsewhere = $derived(wasUnpaid && !!row && !row.skeleton);
  const paymentChanged = $derived(prefilled && !same(openedRow, row ?? null));
  const arrived = $derived(
    row && !row.fxPending ? `A payment of ${formatGBP(row.amountGBP)}` : 'A payment',
  );
  // A dinar never prices itself, however long you wait online, so a booking in
  // one with no £ would sit in the ledger reading as nothing paid while the
  // sheet says it was. Ask for the £ instead of saving a figure of zero.
  const mustTypePounds = $derived(needsPounds && !ecbPublishes(currency) && num(gbp) === 0);
  // A hand-typed £ emptied is a decision, not an absence. The row would
  // otherwise keep the figure that was just cleared — "nothing that decided it
  // moved" cannot see a field going blank — while the hint below promises the
  // rate. Hand it back to the rate, the way clearing any other field here
  // clears what it held.
  const clearedManualGBP = $derived(
    !!row && !row.skeleton && isManualGBP(row) && showPounds && num(gbp) === 0,
  );
  const priced = $derived(
    priceEntry({
      amount: money,
      currency,
      date,
      // Only while its field is on screen: see showPounds, and priceEntry.
      overrideGBP: showPounds ? num(gbp) || null : null,
      rate,
      ...(openedRow && !openedRow.skeleton && !clearedManualGBP
        ? {
            recorded: {
              amount: openedRow.currency === 'GBP' ? openedRow.amountGBP : openedRow.amountLocal,
              amountGBP: openedRow.amountGBP,
              currency: openedRow.currency,
              date: openedRow.date,
              fxRate: openedRow.fxRate,
              fxPending: openedRow.fxPending,
            },
          }
        : {}),
    }),
  );
  const atRate = $derived(`About ${formatGBP(priced.amountGBP)} at the rate for the payment date.`);
  const spec = $derived(need.book);

  const wouldReplace = $derived(paymentChanged && money > 0);
  // Anything on this sheet that no longer says what the trip says. Emptying
  // the last detail is a change worth saving: this sheet is where a wrong
  // hotel name or a provider that was never going to be comes back off.
  const changed = $derived(
    !!context &&
      (ref !== (context.ref ?? '') ||
        place !== (context.place ?? '') ||
        transport !== (context.plan.transport ?? '') ||
        journeyMin !== (context.plan.journeyMin?.toString() ?? '') ||
        transferAt !== (context.plan.transferAt ?? '') ||
        transferArr !== (context.plan.transferArr ?? '') ||
        payOnDay !== (context.plan.payOnDay ?? false) ||
        bothWays !== context.bothWays),
  );
  // A free reservation has nothing to type: saving it *is* the record.
  const valid = $derived(
    prefilled &&
      !invalidAmount &&
      !invalidPounds &&
      !mustTypePounds &&
      !wouldReplace &&
      (need.kind === 'book' ||
        money > 0 ||
        changed ||
        !!ref.trim() ||
        !!transport.trim() ||
        !!place.trim() ||
        !!journeyMin.trim() ||
        !!transferAt.trim()),
  );

  async function save() {
    if (!valid) return;
    saving = true;
    error = '';
    try {
      const mins = Number(journeyMin);
      const { expenseId, need: saved } = await bookNeed(trip, need, {
        expectedExpense: openedRow,
        ...(quotedAmount && recordingPayment ? { quotePartySize: openedPartySize } : {}),
        amountGBP: priced.amountGBP,
        amountLocal: priced.amountLocal,
        currency: priced.currency,
        fxRate: priced.fxRate,
        gbpManual: priced.keepRecorded && openedRow ? isManualGBP(openedRow) : priced.gbpManual,
        fxPending: priced.fxPending,
        ref: ref.trim(),
        transport: transport.trim(),
        journeyMin: journeyMin.trim() && Number.isFinite(mins) && mins >= 0 ? mins : null,
        transferAt: transferAt.trim(),
        transferArr: transferArr.trim(),
        payOnDay,
        place: place.trim(),
        bothWays,
        date,
        paymentMethod: openedRow?.paymentMethod,
      });
      const word = STATE_WORD[saved.state];
      onDone(
        expenseId
          ? priced.fxPending
            ? `${need.label}: paid, saved in Expenses with GBP still awaiting a rate.`
            : `${need.label}: ${word}, and ${formatGBP(priced.amountGBP)} is in Expenses — no need to enter it again.`
          : saved.done
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
  aria-labelledby="booking-title"
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
      <h2 class="modal-title" id="booking-title">{need.label}</h2>
      <button class="btn btn--primary btn--sm" onclick={save} disabled={saving || !valid}
        >Save</button
      >
    </header>
    <div class="modal-body">
      {#if !prefilled}
        {#if context === null}<p class="hint hint--warn" role="alert">
            This booking is no longer available. Close and reopen it from the trip.
          </p>
        {:else}<p class="hint" role="status">Loading booking…</p>{/if}
      {/if}
      {#if prefilled}
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
              oninput={() => {
                quotedAmount = false;
                recordPayment = true;
              }}
            />
          </div>
          <div>
            <label class="label" for="book-ccy">Paid in</label>
            <select id="book-ccy" class="field" value={currency} onchange={changeCurrency}>
              {#each [...new Set([...FARE_CURRENCIES, currency])] as c (c)}
                <option value={c}>{c}</option>
              {/each}
            </select>
          </div>
        </div>
        {#if invalidAmount || invalidPounds}
          <p class="hint hint--warn" role="alert">Enter a valid amount. {MONEY_HINT}</p>
        {/if}
        {#if showPounds}
          <label class="label" for="book-gbp">Amount (GBP){rate != null ? ' override' : ''}</label>
          <input
            id="book-gbp"
            class="field"
            type="text"
            inputmode="decimal"
            bind:value={gbp}
            oninput={() => (gbpTouched = true)}
          />
          <p class="hint" class:hint--warn={mustTypePounds}>
            {#if needsPounds}
              {ecbPublishes(currency)
                ? `No ${currency} rate to hand — it prices itself when you are next online, or put the £ in now.`
                : `No ${currency} rate is available. Enter the GBP total from your statement.`}
            {:else if num(gbp) > 0}
              The £ was entered by hand and is kept; change it here if needed.
            {:else}
              {atRate}
            {/if}
          </p>
        {:else if !isGBP && money > 0}
          <p class="hint">{atRate}</p>
        {/if}
        {#if quotedUnpaid && usableQuote}
          <label class="switch">
            <input type="checkbox" bind:checked={recordPayment} />
            <span>Record this amount as paid</span>
          </label>
        {/if}
        {#if wouldReplace}
          <p class="hint hint--warn" role="alert">
            The payment changed elsewhere while this was open{row && !row.skeleton
              ? ` (${arrived.toLowerCase()})`
              : ''}. Close and reopen to review it before saving an amount.
          </p>
        {:else if paidElsewhere}
          <p class="hint" role="status">
            {arrived} was recorded for this elsewhere. Saving booking details alone leaves it as it is.
          </p>
        {:else}
          <p class="hint">
            {#if quotedUnpaid}
              Historical quote: {formatGBP(quote!)}. {row?.quote?.note ||
                'Original party size not recorded.'}
              {usableQuote
                ? 'Confirm it as paid, or enter the actual amount.'
                : `This is not a quote for the current party of ${context?.partySize}. Enter the actual total paid.`}
              Saving booking details alone keeps it unpaid.
            {:else}
              Enter what you paid. Leave the amount blank to save booking details only.
            {/if}
          </p>
        {/if}

        {#if spec?.asksPlace}
          <label class="label" for="book-place">Where you are staying</label>
          <input id="book-place" class="field" type="text" bind:value={place} />
          <p class="hint">
            A name is a choice. It counts as booked once there is a reference below.
          </p>
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
              The same ticket covers the way back. Each journey keeps its own times.
            </span>
          </label>
          <label class="switch">
            <input type="checkbox" bind:checked={payOnDay} />
            <span class="hint"> Pay on the day. Name the ride and add its times or duration. </span>
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
      {/if}
    </div>
  </div>
</dialog>

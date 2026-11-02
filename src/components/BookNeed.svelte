<script lang="ts">
  import { onMount } from 'svelte';
  import type { Trip } from '../lib/db';
  import { bookNeed, settles, STATE_WORD, type Need, type NeedState } from '../lib/needs';
  import { todayIso } from '../lib/sheet';

  /**
   * Recording a booking: the money and the travel detail in one go.
   *
   * This is the point of "a booking is structured state". Booking the £22
   * coach writes the fare into the ledger *and* the mode and journey time onto
   * the departure, against the same requirement — so the readiness card stops
   * asking, the countdown knows how long the journey takes, and £22 is never
   * typed into Expenses a second time.
   */
  let {
    trip,
    need,
    onClose,
    onDone,
  }: { trip: Trip; need: Need; onClose: () => void; onDone: (message: string) => void } = $props();

  let dialogEl: HTMLDialogElement;
  let amount = $state('');
  let ref = $state('');
  let transport = $state('');
  let journeyMin = $state('');
  let place = $state('');
  let bothWays = $state(false);
  let date = $state(todayIso());
  let error = $state('');
  let saving = $state(false);
  onMount(() => dialogEl.showModal());

  const spec = $derived(need.book);
  const money = $derived(Number(amount.replace(/[£,\s]/g, '')));
  // A free reservation has nothing to type: saving it *is* the record.
  const valid = $derived(
    need.kind === 'book' ||
      (money > 0 && Number.isFinite(money)) ||
      !!ref.trim() ||
      !!transport.trim() ||
      !!place.trim() ||
      !!journeyMin.trim(),
  );

  // What this will actually leave behind — so the sheet never reports a thing
  // as sorted that the trip still reads as outstanding. A hotel with a name and
  // no reference is a choice; a transfer you will pay for on the day is enough.
  const willBe = $derived<NeedState>(
    money > 0 && Number.isFinite(money)
      ? 'paid'
      : ref.trim() || need.kind === 'book'
        ? 'booked'
        : transport.trim() || journeyMin.trim() || place.trim()
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
        amountGBP: money > 0 && Number.isFinite(money) ? money : 0,
        ref: ref.trim() || undefined,
        transport: transport.trim() || undefined,
        journeyMin: journeyMin.trim() && Number.isFinite(mins) && mins >= 0 ? mins : undefined,
        place: place.trim() || undefined,
        bothWays,
        date,
      });
      const word = STATE_WORD[willBe];
      onDone(
        expenseId
          ? `${need.label}: ${word}, and £${money} is in Expenses — no need to enter it again.`
          : settles(need.kind, willBe)
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

      <label class="label" for="book-amount">What it cost, for everyone (£)</label>
      <input id="book-amount" class="field" type="text" inputmode="decimal" bind:value={amount} />
      <p class="hint">
        Goes straight into Expenses as {spec?.subcategory}{spec?.shared ? ', trip-wide' : ''} — leave
        it blank if you have not paid yet.
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
        <label class="label" for="book-journey">How long it takes (minutes)</label>
        <input
          id="book-journey"
          class="field"
          type="text"
          inputmode="numeric"
          placeholder="75"
          bind:value={journeyMin}
        />
        <p class="hint">The countdown counts back from this, so leave-by stops being a guess.</p>
        <label class="switch">
          <input type="checkbox" bind:checked={bothWays} />
          <span class="hint">
            The same ticket covers the way back. Both journeys keep their own line — they happen at
            different hours — but this one purchase settles both.
          </span>
        </label>
      {/if}

      <label class="label" for="book-ref">Booking reference</label>
      <input id="book-ref" class="field" type="text" bind:value={ref} />
      {#if need.kind === 'book'}
        <p class="hint">Saving this records the reservation, whether or not it cost anything.</p>
      {:else if spec?.asksTransport}
        <p class="hint">
          Only for a ticket you hold — leave it blank for a fare you pay on the day.
        </p>
      {/if}

      <label class="label" for="book-date">Paid on</label>
      <input id="book-date" class="field" type="date" bind:value={date} />
    </div>
  </div>
</dialog>

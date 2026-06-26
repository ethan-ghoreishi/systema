<script lang="ts">
  import { untrack } from 'svelte';
  import { db, type City, type Expense, type Trip } from '../lib/db';
  import { newId } from '../lib/ids';
  import { getRate } from '../lib/fx';
  import { addExpense, updateExpense } from '../lib/expenses';
  import { syncTrip } from '../lib/sync';
  import { categories, subcategories, paymentMethods } from '../lib/vocab';
  import { formatAmount, formatGBP, perPersonNote } from '../lib/money';
  import { todayIso } from '../lib/sheet';
  import Keypad from './Keypad.svelte';
  import Icon from './Icon.svelte';

  let {
    trip,
    cities,
    expense,
    onClose,
  }: {
    trip: Trip;
    cities: City[];
    expense: Expense | null;
    onClose: () => void;
  } = $props();

  function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // Snapshot props once on mount — the parent remounts this modal per open, so
  // these are deliberately initial-only (untrack avoids the reactive warning).
  const { currencyOptions, init } = untrack(() => {
    const first = cities[0] ?? null;
    const ex = expense;
    const codes: string[] = [];
    for (const c of cities) {
      const code = c.currency?.trim().toUpperCase();
      if (code && !codes.includes(code)) codes.push(code);
    }
    if (!codes.includes('GBP')) codes.push('GBP');
    return {
      currencyOptions: codes,
      init: {
        amountStr:
          ex && !ex.skeleton ? String(ex.currency === 'GBP' ? ex.amountGBP : ex.amountLocal) : '',
        currency: ex?.currency || first?.currency?.trim().toUpperCase() || 'GBP',
        category: ex?.category ?? '',
        subcategory: ex?.subcategory ?? '',
        paymentMethod: ex?.paymentMethod ?? '',
        description: ex?.description ?? '',
        notes: ex?.notes ?? '',
        date: ex?.date || todayIso(),
        cityId: ex?.cityId ?? first?.id ?? null,
        destination: ex?.destination || first?.name || '',
      },
    };
  });

  let amountStr = $state(init.amountStr);
  let currency = $state(init.currency);
  let category = $state(init.category);
  let subcategory = $state(init.subcategory);
  let paymentMethod = $state(init.paymentMethod);
  let description = $state(init.description);
  let notes = $state(init.notes);
  let date = $state(init.date);
  let cityId = $state<string | null>(init.cityId);
  let destination = $state(init.destination);
  let overrideGBP = $state('');
  let receiptFile = $state<File | null>(null);

  let rate = $state<number | null>(null);
  let rateStale = $state(false);
  let rateMissing = $state(false);

  $effect(() => {
    const c = currency;
    if (c === 'GBP') {
      rate = 1;
      rateStale = false;
      rateMissing = false;
      return;
    }
    let cancelled = false;
    getRate(c).then((r) => {
      if (cancelled) return;
      if (r) {
        rate = r.rate;
        rateStale = r.stale;
        rateMissing = false;
      } else {
        rate = null;
        rateMissing = true;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const isGBP = $derived(currency === 'GBP');
  const localNum = $derived(parseFloat(amountStr) || 0);
  const computedGBP = $derived(isGBP ? localNum : rate != null ? round2(localNum * rate) : null);
  const overrideNum = $derived(overrideGBP.trim() ? parseFloat(overrideGBP) || 0 : null);
  const finalGBP = $derived(overrideNum != null ? overrideNum : (computedGBP ?? 0));
  const subOptions = $derived(category ? (subcategories[category] ?? []) : []);

  const canSave = $derived(
    localNum > 0 &&
      category !== '' &&
      subcategory !== '' &&
      paymentMethod !== '' &&
      destination.trim() !== '' &&
      (isGBP || rate != null || overrideNum != null),
  );

  function pickCategory(c: string) {
    category = c;
    subcategory = '';
  }

  function pickCity(id: string) {
    cityId = id;
    const c = cities.find((x) => x.id === id);
    if (c) {
      destination = c.name;
      if (c.currency) currency = c.currency.trim().toUpperCase();
    }
  }

  function addPerPerson() {
    const base = isGBP ? finalGBP : localNum;
    if (base <= 0) return;
    const note = perPersonNote(trip.partySize, base, isGBP ? 'GBP' : currency);
    notes = notes.trim() ? `${notes.trim()} · ${note}` : note;
  }

  function onReceipt(e: Event) {
    receiptFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
  }

  async function save() {
    if (!canSave) return;

    const usingAutoRate = !isGBP && overrideNum == null && rate != null;
    let finalNotes = notes.trim();
    if (usingAutoRate) {
      const fxNote = `FX: 1 ${currency} = £${rate}`;
      finalNotes = finalNotes ? `${finalNotes} · ${fxNote}` : fxNote;
    }

    const fields = {
      cityId,
      destination: destination.trim(),
      date,
      category,
      subcategory,
      description: description.trim(),
      paymentMethod,
      amountGBP: finalGBP,
      amountLocal: isGBP ? 0 : localNum,
      currency: isGBP ? 'GBP' : currency,
      fxRate: isGBP ? null : overrideNum != null ? null : rate,
      notes: finalNotes,
    };

    let expenseId: string;
    if (expense) {
      await updateExpense(expense.id, { ...fields, skeleton: false, synced: false });
      expenseId = expense.id;
    } else {
      expenseId = await addExpense(trip.id, fields);
    }

    if (receiptFile) {
      await db.photos.add({
        id: newId(),
        tripId: trip.id,
        stopId: null,
        expenseId,
        kind: 'receipt',
        blob: receiptFile,
        createdAt: Date.now(),
      });
    }

    if (navigator.onLine) void syncTrip(trip.id);
    onClose();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') onClose();
  }}
/>

<div class="modal">
  <button class="modal-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="modal-sheet">
    <header class="modal-head">
      <h2 class="modal-title">{expense && !expense.skeleton ? 'Edit expense' : 'Add expense'}</h2>
      <button class="icon-btn" aria-label="Close" onclick={onClose}><Icon name="back" /></button>
    </header>

    <div class="modal-body">
      <div class="amount-display">
        <span class="amount-local">{formatAmount(localNum, currency)}</span>
        {#if !isGBP}
          <span class="amount-gbp">
            {#if rateMissing && overrideNum == null}
              no rate for {currency} — enter £ below
            {:else}
              = {formatGBP(finalGBP)}{rateStale ? ' (cached rate)' : ''}
            {/if}
          </span>
        {/if}
      </div>

      <div class="chips ccy-chips">
        {#each currencyOptions as c (c)}
          <button class="chip" class:chip--on={currency === c} onclick={() => (currency = c)}
            >{c}</button
          >
        {/each}
      </div>

      <Keypad bind:value={amountStr} />

      {#if !isGBP}
        <div class="field-row">
          <label class="label" for="gbp-override"
            >Amount (GBP){rateMissing ? '' : ' override'}</label
          >
          <input
            id="gbp-override"
            class="field gbp-override"
            type="text"
            inputmode="decimal"
            placeholder={computedGBP != null ? formatGBP(computedGBP) : '£'}
            bind:value={overrideGBP}
          />
        </div>
      {/if}

      <div>
        <span class="label">Category</span>
        <div class="chips">
          {#each categories as c (c)}
            <button class="chip" class:chip--on={category === c} onclick={() => pickCategory(c)}
              >{c}</button
            >
          {/each}
        </div>
      </div>

      {#if subOptions.length}
        <div>
          <span class="label">Subcategory</span>
          <div class="chips">
            {#each subOptions as sc (sc)}
              <button
                class="chip"
                class:chip--on={subcategory === sc}
                onclick={() => (subcategory = sc)}>{sc}</button
              >
            {/each}
          </div>
        </div>
      {/if}

      <div>
        <span class="label">Payment</span>
        <div class="chips">
          {#each paymentMethods as pm (pm)}
            <button
              class="chip"
              class:chip--on={paymentMethod === pm}
              onclick={() => (paymentMethod = pm)}>{pm}</button
            >
          {/each}
        </div>
      </div>

      {#if cities.length > 1}
        <div>
          <span class="label">City</span>
          <div class="chips">
            {#each cities as c (c.id)}
              <button class="chip" class:chip--on={cityId === c.id} onclick={() => pickCity(c.id)}
                >{c.name}</button
              >
            {/each}
          </div>
        </div>
      {/if}

      <div>
        <label class="label" for="desc">Description</label>
        <input
          id="desc"
          class="field"
          type="text"
          placeholder="e.g. Belvedere Museum Entry"
          bind:value={description}
        />
      </div>

      <div>
        <label class="label" for="dest">Destination</label>
        <input
          id="dest"
          class="field"
          type="text"
          placeholder="City, or CityA/CityB"
          bind:value={destination}
        />
      </div>

      <div>
        <label class="label" for="exp-date">Date</label>
        <input id="exp-date" class="field" type="date" bind:value={date} />
      </div>

      <div>
        <div class="notes-head">
          <label class="label" for="notes">Notes</label>
          <button class="btn btn--ghost btn--sm" onclick={addPerPerson} type="button">
            + {trip.partySize}× per person
          </button>
        </div>
        <textarea id="notes" class="field" rows="2" bind:value={notes}></textarea>
      </div>

      <label class="btn btn--ghost receipt-btn">
        <Icon name="camera" size={20} />
        {receiptFile ? 'Receipt attached' : 'Add receipt photo'}
        <input type="file" accept="image/*" capture="environment" hidden onchange={onReceipt} />
      </label>
    </div>

    <footer class="modal-foot">
      <button class="btn btn--ghost" onclick={onClose}>Cancel</button>
      <button class="btn btn--primary" onclick={save} disabled={!canSave}>Save</button>
    </footer>
  </div>
</div>

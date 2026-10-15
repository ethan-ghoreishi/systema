<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db, type City, type Expense, type Trip } from '../lib/db';
  import { getRate } from '../lib/fx';
  import {
    addExpense,
    deleteExpense,
    updateExpense,
    resolvePendingFx,
    withFxNote,
  } from '../lib/expenses';
  import {
    TEMPLATES,
    findDuplicate,
    isManualGBP,
    isShared,
    lastPaymentMethod,
    likelySubcategory,
    recentTemplates,
    sharedDestination,
    type ExpenseTemplate,
  } from '../lib/expense-defaults';
  import { categories, subcategories, paymentMethods } from '../lib/vocab';
  import { formatAmount, formatGBP, perPersonNote } from '../lib/money';
  import { todayIso } from '../lib/sheet';
  import { activeLegId } from '../lib/trip-shape';
  import { preparePhotos } from '../lib/photos';
  import Keypad from './Keypad.svelte';
  import Icon from './Icon.svelte';
  import PhotoPicker from './PhotoPicker.svelte';

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

  // A native <dialog> in the top layer: it paints above every stacking context
  // and escapes ancestor scrollers. (position:fixed inside an overflow scroller
  // paints contained in iOS standalone mode — the modal rendered *between* the
  // top bar and tab bar on the phone while still eating their taps.)
  let dialogEl: HTMLDialogElement;
  onMount(() => dialogEl.showModal());

  // Every expense, for recent picks, the last payment method and duplicates.
  const allQ = liveQuery(() => db.expenses.toArray());
  const all = $derived($allQ ?? []);
  const recents = $derived(recentTemplates(all));

  // Snapshot props once on mount — the parent remounts this modal per open, so
  // these are deliberately initial-only (untrack avoids the reactive warning).
  const { currencyOptions, init } = untrack(() => {
    const here = cities.find((c) => c.id === activeLegId(cities)) ?? cities[0] ?? null;
    const ex = expense;
    const codes: string[] = [];
    for (const c of cities) {
      const code = c.currency?.trim().toUpperCase();
      if (code && !codes.includes(code)) codes.push(code);
    }
    if (!codes.includes('GBP')) codes.push('GBP');
    const shared = ex ? isShared(ex) : false;
    return {
      currencyOptions: codes,
      init: {
        amountStr:
          ex && !ex.skeleton ? String(ex.currency === 'GBP' ? ex.amountGBP : ex.amountLocal) : '',
        currency: ex?.currency || here?.currency?.trim().toUpperCase() || 'GBP',
        category: ex?.category ?? '',
        subcategory: ex?.subcategory ?? '',
        paymentMethod: ex?.paymentMethod ?? '',
        description: ex?.description ?? '',
        notes: ex?.notes ?? '',
        date: ex?.date || todayIso(),
        cityId: ex ? ex.cityId : (here?.id ?? null),
        shared,
        destination: ex?.destination || here?.name || '',
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
  let shared = $state(init.shared);
  let destination = $state(init.destination);
  let destinationTouched = $state(untrack(() => !!expense));
  // A £ typed by hand stays in the override field, so editing the date or the
  // amount can never swap it for a rate.
  const manualGBP = untrack(() => !!expense && isManualGBP(expense));
  let overrideGBP = $state(untrack(() => (manualGBP ? String(expense!.amountGBP) : '')));
  let saving = $state(false);
  let saveError = $state('');
  let receiptFiles = $state<File[]>([]);
  let duplicateOf = $state<Expense | null>(null);

  // The last payment method, once the ledger has loaded (new expenses only).
  $effect(() => {
    if (!expense && !paymentMethod && $allQ) paymentMethod = lastPaymentMethod(all, trip.id);
  });

  let rate = $state<number | null>(null);
  let rateDate = $state<string | null>(null);
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
    rate = null;
    rateStale = false;
    rateMissing = true;
    let cancelled = false;
    getRate(c, date).then((r) => {
      if (cancelled) return;
      if (r) {
        rate = r.rate;
        rateDate = r.date;
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
  const overrideNum = $derived(overrideGBP.trim() ? Number(overrideGBP) : null);
  // An existing expense keeps the GBP value it was recorded with unless its
  // source (amount, currency, date) or the £ itself is changed: a later rate
  // never rewrites what was paid.
  const keepRecorded = $derived(
    expense &&
      !expense.skeleton &&
      !expense.fxPending &&
      currency === init.currency &&
      amountStr === init.amountStr &&
      date === init.date &&
      overrideNum == null,
  );
  const finalGBP = $derived(
    keepRecorded ? expense!.amountGBP : overrideNum != null ? overrideNum : (computedGBP ?? 0),
  );
  const subOptions = $derived(category ? (subcategories[category] ?? []) : []);

  // No GBP required: a non-GBP amount with no rate saves as "awaiting rate"
  // and prices itself from the ECB rate for its date once online.
  const canSave = $derived(
    !saving &&
      Number.isFinite(localNum) &&
      localNum > 0 &&
      (overrideNum == null || (Number.isFinite(overrideNum) && overrideNum >= 0)) &&
      category !== '' &&
      subcategory !== '' &&
      paymentMethod !== '' &&
      destination.trim() !== '',
  );

  function pickCategory(c: string) {
    category = c;
    subcategory = likelySubcategory(c, all);
    duplicateOf = null;
  }

  function pickTemplate(t: ExpenseTemplate) {
    category = t.category;
    subcategory = t.subcategory;
    if (t.description) description = t.description;
    if (t.paymentMethod) paymentMethod = t.paymentMethod;
    if (t.shared && cities.length) setShared(true);
    duplicateOf = null;
  }

  function pickCity(id: string) {
    shared = false;
    cityId = id;
    const c = cities.find((x) => x.id === id);
    if (c) {
      if (!destinationTouched) destination = c.name;
      if (c.currency) currency = c.currency.trim().toUpperCase();
    }
  }

  function setShared(on: boolean) {
    shared = on;
    if (on) {
      cityId = null;
      if (!destinationTouched) destination = sharedDestination(cities) || destination;
    } else if (cities.length) pickCity(cityId ?? cities[0].id);
  }

  function addPerPerson() {
    const base = isGBP ? finalGBP : localNum;
    if (base <= 0) return;
    const note = perPersonNote(trip.partySize, base, isGBP ? 'GBP' : currency);
    notes = notes.trim() ? `${notes.trim()} · ${note}` : note;
  }

  async function save() {
    if (!canSave) return;

    const usingAutoRate = !keepRecorded && !isGBP && overrideNum == null && rate != null;
    const unpriced = !keepRecorded && !isGBP && overrideNum == null && rate == null;
    const fields = {
      cityId: shared ? null : cityId,
      shared,
      destination: destination.trim(),
      date,
      category,
      subcategory,
      description: description.trim(),
      paymentMethod,
      amountGBP: unpriced ? 0 : finalGBP,
      amountLocal: isGBP ? 0 : localNum,
      currency: isGBP ? 'GBP' : currency,
      fxRate: keepRecorded ? expense!.fxRate : isGBP ? null : overrideNum != null ? null : rate,
      ...(keepRecorded
        ? {}
        : {
            fxDate: usingAutoRate ? (rateDate ?? date) : undefined,
            gbpManual: overrideNum != null,
          }),
      fxPending: unpriced,
      notes: keepRecorded ? notes.trim() : withFxNote(notes, currency, usingAutoRate ? rate : null),
    };

    // A likely double entry: say so once, then save if asked again.
    const dup = findDuplicate({ tripId: trip.id, ...fields }, all, expense?.id);
    if (dup && duplicateOf?.id !== dup.id) {
      duplicateOf = dup;
      return;
    }

    saving = true;
    saveError = '';
    try {
      // Read and hash the receipts first: that can't happen inside the write.
      const receipts = receiptFiles.length
        ? await preparePhotos(receiptFiles, { tripId: trip.id, kind: 'receipt' })
        : [];
      await db.transaction('rw', db.expenses, db.photos, async () => {
        let expenseId: string;
        if (expense) {
          await updateExpense(expense.id, { ...fields, skeleton: false });
          expenseId = expense.id;
        } else {
          expenseId = await addExpense(trip.id, fields);
        }
        if (receipts.length) await db.photos.bulkAdd(receipts.map((r) => ({ ...r, expenseId })));
      });

      // If this was saved without a rate, price it now while we're online.
      if (navigator.onLine) void resolvePendingFx(trip.id);
      onClose();
    } catch (err) {
      saveError = `Not saved: ${err instanceof Error ? err.message : String(err)}. Your entry is still here; try again.`;
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!expense) return;
    const msg = expense.skeleton ? 'Remove this skeleton row?' : 'Delete this expense?';
    if (confirm(msg)) {
      await deleteExpense(expense.id);
      onClose();
    }
  }

  const picks = $derived([
    ...recents,
    ...TEMPLATES.filter(
      (t) => !recents.some((r) => r.category === t.category && r.subcategory === t.subcategory),
    ),
  ]);
</script>

<!-- Escape triggers the dialog's native cancel → close → onClose. -->
<dialog
  class="modal"
  bind:this={dialogEl}
  onclose={onClose}
  oncancel={(e) => {
    if (saving) e.preventDefault();
  }}
>
  <div class="modal-sheet">
    <!-- Action bar pinned at the top: Cancel (left), Save (right). Always
         reachable, keyboard or not — the native iOS form pattern. -->
    <header class="modal-head">
      <button class="btn btn--ghost btn--sm modal-cancel" onclick={onClose} disabled={saving}
        >Cancel</button
      >
      <h2 class="modal-title">{expense && !expense.skeleton ? 'Edit expense' : 'Add expense'}</h2>
      <button class="btn btn--primary btn--sm modal-save" onclick={save} disabled={!canSave}
        >{duplicateOf ? 'Save anyway' : 'Save'}</button
      >
    </header>

    <div class="modal-body">
      {#if saveError}<p role="alert" class="hint hint--warn">{saveError}</p>{/if}
      {#if duplicateOf}
        <p role="alert" class="hint hint--warn">
          Looks like one already saved: {duplicateOf.description || duplicateOf.subcategory},
          {duplicateOf.currency === 'GBP'
            ? formatGBP(duplicateOf.amountGBP)
            : formatAmount(duplicateOf.amountLocal, duplicateOf.currency)} on this day. Tap “Save anyway”
          if it's a second one.
        </p>
      {/if}
      <div class="amount-display">
        <span class="amount-local">{formatAmount(localNum, currency)}</span>
        {#if !isGBP}
          <span class="amount-gbp">
            {#if rateMissing && overrideNum == null}
              no rate right now — saves anyway, prices itself when online
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

      <div>
        <span class="label">Quick pick</span>
        <div class="chips quick-picks">
          {#each picks as t (t.key)}
            <button
              class="chip chip--sm"
              class:chip--on={category === t.category &&
                subcategory === t.subcategory &&
                (!t.description || description === t.description)}
              onclick={() => pickTemplate(t)}>{t.label}</button
            >
          {/each}
        </div>
      </div>

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
                onclick={() => {
                  subcategory = sc;
                  duplicateOf = null;
                }}>{sc}</button
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
          <span class="label">For</span>
          <div class="chips">
            {#each cities as c (c.id)}
              <button
                class="chip"
                class:chip--on={!shared && cityId === c.id}
                onclick={() => pickCity(c.id)}>{c.name}</button
              >
            {/each}
            <button class="chip" class:chip--on={shared} onclick={() => setShared(true)}
              >Whole trip</button
            >
          </div>
        </div>
      {/if}

      <details class="more-details" open={!!expense && !expense.skeleton}>
        <summary>More details</summary>
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
            placeholder="City (the sheet's Destination column)"
            bind:value={destination}
            oninput={() => (destinationTouched = true)}
          />
        </div>

        {#if cities.length <= 1}
          <label class="switch">
            <input type="checkbox" checked={shared} onchange={() => setShared(!shared)} />
            <span>Trip-wide (not this city's spend)</span>
          </label>
        {/if}

        <div>
          <label class="label" for="exp-date">Date</label>
          <input id="exp-date" class="field" type="date" bind:value={date} />
        </div>

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
          {#if manualGBP}
            <p class="hint">The £ was entered by hand and is kept; change it here if needed.</p>
          {:else if rate != null && overrideNum == null && !keepRecorded}
            <p class="hint">
              ECB rate{rateDate ? ` for ${rateDate}` : ''}: 1 {currency} = £{rate}. Type a £ amount
              to use your own; it's never re-priced.
            </p>
          {/if}
        {/if}

        <div>
          <div class="notes-head">
            <label class="label" for="notes">Notes</label>
            <button class="btn btn--ghost btn--sm" onclick={addPerPerson} type="button">
              + {trip.partySize}× per person
            </button>
          </div>
          <textarea id="notes" class="field" rows="2" bind:value={notes}></textarea>
        </div>

        <div>
          <span class="label">Receipt</span>
          <PhotoPicker
            onFiles={(f) => (receiptFiles = [...receiptFiles, ...f])}
            disabled={saving}
          />
          {#if receiptFiles.length}
            <p class="hint">
              {receiptFiles.length} receipt photo{receiptFiles.length > 1 ? 's' : ''} attached.
            </p>
          {/if}
        </div>
      </details>

      {#if expense}
        <button class="btn btn--danger delete-expense" onclick={remove}>
          <Icon name="trash" size={18} /> Delete {expense.skeleton ? 'row' : 'expense'}
        </button>
      {/if}
    </div>
  </div>
</dialog>

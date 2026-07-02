<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type Expense, type Trip } from '../../lib/db';
  import {
    realExpenses,
    tripTotalGBP,
    categorySummary,
    looksAnomalous,
    seedSkeleton,
  } from '../../lib/expenses';
  import { syncTrip, appendSubtotalRow } from '../../lib/sync';
  import { presetByType } from '../../lib/presets';
  import { formatGBP, formatAmount } from '../../lib/money';
  import { settingsStore } from '../../lib/settings.svelte';
  import ExpenseCapture from '../ExpenseCapture.svelte';
  import Icon from '../Icon.svelte';

  let { trip }: { trip: Trip } = $props();

  const expensesQ = liveQuery(() => db.expenses.where('tripId').equals(trip.id).sortBy('order'));
  const citiesQ = liveQuery(() => db.cities.where('tripId').equals(trip.id).sortBy('order'));
  const expenses = $derived($expensesQ ?? []);
  const cities = $derived($citiesQ ?? []);

  const real = $derived(realExpenses(expenses));
  const skeletons = $derived(expenses.filter((e) => e.skeleton));
  const total = $derived(tripTotalGBP(expenses));
  const summary = $derived(categorySummary(expenses));
  const pending = $derived(real.filter((e) => !e.synced).length);
  const editedCount = $derived(real.filter((e) => e.synced && e.editedAfterSync).length);

  const hasUrl = $derived(settingsStore.current.webAppUrl.trim() !== '');
  const presetSkeletonCount = $derived(presetByType(trip.type).skeleton.length);

  // `cities` is otherwise only read inside the capture modal, which would delay
  // its liveQuery subscription until first open. Read it eagerly so currencies
  // are ready by the time capture opens.
  $effect(() => {
    void cities;
  });

  let captureOpen = $state(false);
  let captureExpense = $state<Expense | null>(null);
  let captureKey = $state(0);

  let busy = $state(false);
  let statusMsg = $state('');

  function openNew() {
    captureExpense = null;
    captureKey += 1;
    captureOpen = true;
  }
  function openEdit(e: Expense) {
    captureExpense = e;
    captureKey += 1;
    captureOpen = true;
  }

  async function doSync() {
    busy = true;
    statusMsg = '';
    const r = await syncTrip(trip.id);
    busy = false;
    statusMsg = r.ok
      ? r.synced
        ? `Synced ${r.synced} row(s)`
        : 'Nothing to sync'
      : `Failed: ${r.error}`;
  }

  async function doSubtotal() {
    busy = true;
    statusMsg = '';
    const r = await appendSubtotalRow(trip.id);
    busy = false;
    statusMsg = r.ok ? 'Subtotal row appended' : `Failed: ${r.error}`;
  }
</script>

<div class="expenses">
  <div class="card total-card">
    <div class="total-row-top">
      <div>
        <span class="section-title">Trip total</span>
        <span class="total-value">{formatGBP(total)}</span>
      </div>
      <button class="btn btn--primary" onclick={openNew}>
        <Icon name="plus" size={20} /> Add
      </button>
    </div>

    {#if summary.length}
      <div class="summary">
        {#each summary as row (row.category)}
          <div class="summary-row">
            <span class="summary-cat">{row.category}</span>
            <span class="summary-amt">{formatGBP(row.total)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="card sync-card">
    {#if !hasUrl}
      <p class="hint hint--warn">
        No capture URL set. Add it in <a href="#/settings">Settings</a> to sync.
      </p>
    {/if}
    <div class="sync-actions">
      <button class="btn btn--ghost" onclick={doSync} disabled={busy || !hasUrl}>
        {pending > 0 ? `Sync ${pending} pending` : 'Sync'}
      </button>
      <button class="btn btn--ghost" onclick={doSubtotal} disabled={busy || !hasUrl}>
        Append subtotal row
      </button>
    </div>
    {#if editedCount > 0}
      <p class="hint hint--warn">
        {editedCount} row{editedCount > 1 ? 's were' : ' was'} edited after syncing. The sheet is append-only,
        so amend {editedCount > 1 ? 'those rows' : 'that row'} there when you reconcile.
      </p>
    {/if}
    {#if statusMsg}<p class="hint">{statusMsg}</p>{/if}
  </div>

  {#if expenses.length === 0 && presetSkeletonCount > 0}
    <button class="btn btn--ghost" onclick={() => seedSkeleton(trip)}>
      Add the {presetSkeletonCount} skeleton rows for a {presetByType(trip.type).label} trip
    </button>
  {/if}

  {#if real.length}
    <div class="expense-list">
      {#each real as e, i (e.id)}
        <button class="expense-row" onclick={() => openEdit(e)}>
          <span class="expense-no">{i + 1}</span>
          <span class="expense-main">
            <span class="expense-desc">{e.description || e.subcategory}</span>
            <span class="expense-sub">{e.category} · {e.subcategory}</span>
          </span>
          <span class="expense-amt">
            <span class="expense-gbp">{formatGBP(e.amountGBP)}</span>
            {#if e.currency && e.currency !== 'GBP' && e.amountLocal}
              <span class="expense-local">{formatAmount(e.amountLocal, e.currency)}</span>
            {/if}
          </span>
          {#if looksAnomalous(e)}<span class="flag" title="Local/GBP look mismatched">!</span>{/if}
          {#if e.synced && e.editedAfterSync}
            <span class="pill pill--edited" title="Edited after sync — amend the sheet row"
              >edited</span
            >
          {/if}
          {#if !e.synced}<span class="dot-pending" title="Not yet synced"></span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if skeletons.length}
    <div>
      <span class="section-title">To add</span>
      <div class="expense-list">
        {#each skeletons as e (e.id)}
          <button class="expense-row expense-row--skeleton" onclick={() => openEdit(e)}>
            <span class="expense-no">+</span>
            <span class="expense-main">
              <span class="expense-desc">{e.description || e.subcategory}</span>
              <span class="expense-sub">{e.category} · {e.subcategory}</span>
            </span>
            <span class="expense-amt expense-amt--muted">Tap to add</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if real.length === 0 && skeletons.length === 0}
    <div class="card empty-state">
      <p class="empty-title">No expenses yet</p>
      <p class="hint">Tap “Add” for two-tap capture: type the amount, pick category and payment.</p>
    </div>
  {/if}
</div>

{#if captureOpen}
  {#key captureKey}
    <ExpenseCapture
      {trip}
      {cities}
      expense={captureExpense}
      onClose={() => (captureOpen = false)}
    />
  {/key}
{/if}

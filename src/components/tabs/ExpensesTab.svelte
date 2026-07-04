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
  import { presetByType } from '../../lib/presets';
  import { formatGBP, formatAmount } from '../../lib/money';
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
  const unpricedCount = $derived(real.filter((e) => e.fxPending).length);
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
</script>

<div class="expenses">
  <div class="card total-card">
    <div class="total-row-top">
      <div>
        <span class="section-title">Trip total</span>
        <span class="total-value">{formatGBP(total)}</span>
        {#if unpricedCount > 0}
          <span class="hint" title="Priced automatically from the day's ECB rate when online">
            +{unpricedCount} awaiting a rate
          </span>
        {/if}
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
            <span class="expense-gbp">{e.fxPending ? '£ …' : formatGBP(e.amountGBP)}</span>
            {#if e.currency && e.currency !== 'GBP' && e.amountLocal}
              <span class="expense-local">{formatAmount(e.amountLocal, e.currency)}</span>
            {/if}
          </span>
          {#if e.fxPending}
            <span class="pill pill--fx" title="Awaiting exchange rate — prices itself when online"
              >rate</span
            >
          {/if}
          {#if looksAnomalous(e)}<span class="flag" title="Local/GBP look mismatched">!</span>{/if}
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

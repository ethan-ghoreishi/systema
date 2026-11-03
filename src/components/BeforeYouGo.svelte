<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type City, type Trip } from '../lib/db';
  import {
    STATE_WORD,
    outstanding,
    setCheckedIn,
    tripIsOver,
    tripNeeds,
    type Need,
  } from '../lib/needs';
  import BookNeed from './BookNeed.svelte';

  /**
   * What is still unresolved before this trip — worked out, not ticked.
   *
   * Every line is derived from the trip itself: a booking reference on the
   * flight, a transport mode on the departure, a hotel on the leg, a plan for
   * the city, a payment in the ledger. So the list shrinks as the trip comes
   * together and empties itself at the end, instead of being the twenty-five
   * identical items that get copied from the last trip.
   */
  let { trip, cities }: { trip: Trip; cities: City[] } = $props();

  const expensesQ = liveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray());
  const stopsQ = liveQuery(() => db.stops.where('tripId').equals(trip.id).toArray());

  // Once a minute: only check-in appears on a clock, and it appears calmly.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(t);
  });

  const over = $derived(tripIsOver(trip, cities, now));
  const needs = $derived(tripNeeds(trip, cities, $expensesQ ?? [], $stopsQ ?? [], now));
  const todo = $derived(outstanding(needs));
  const done = $derived(needs.filter((n) => n.done));

  let booking = $state<Need | null>(null);
  let status = $state('');
</script>

{#if trip.status !== 'done' && !over}
  <section class="card before" aria-labelledby="before-title">
    <div class="card-head">
      <span class="section-title" id="before-title">Before you go</span>
      <span class="before-count"
        >{todo.length ? `${todo.length} to sort out` : 'Nothing outstanding'}</span
      >
    </div>

    {#if status}<p class="hint hint--ok" role="status">{status}</p>{/if}

    {#each todo as need (need.key)}
      <div class="need">
        <span class="need-main">
          <span class="need-label">{need.label}</span>
          <span class="need-detail">{need.detail}</span>
        </span>
        {#if need.kind === 'checkin'}
          <button
            class="btn btn--ghost btn--sm"
            onclick={() => void setCheckedIn(trip, need.departureKey!, true)}>Checked in</button
          >
        {:else if need.href}
          <a class="btn btn--ghost btn--sm" href={need.href}>Research</a>
        {:else if need.book}
          <button class="btn btn--ghost btn--sm" onclick={() => (booking = need)}>Book it</button>
        {/if}
      </div>
    {/each}

    {#if done.length}
      <details class="before-done">
        <summary class="section-title">{done.length} already sorted</summary>
        {#each done as need (need.key)}
          <div class="need need--done">
            <span class="need-main">
              <span class="need-label">{need.label}</span>
              <span class="need-detail"
                >{need.evidence ?? need.detail}{#if need.state === 'planned'}<small>
                    · {STATE_WORD[need.state]}</small
                  >{/if}</span
              >
            </span>
            {#if need.kind === 'checkin'}
              <button
                class="btn btn--ghost btn--sm"
                onclick={() => void setCheckedIn(trip, need.departureKey!, false)}>Undo</button
              >
            {:else if need.book && need.state !== 'paid'}
              <!-- Sorted is not paid. The coach you bought last week belongs in
                   the ledger, and hunting for it in Expenses is the friction
                   this card exists to remove. -->
              <button class="btn btn--ghost btn--sm" onclick={() => (booking = need)}
                >Price it</button
              >
            {/if}
          </div>
        {/each}
      </details>
    {/if}

    {#if !todo.length && needs.length}
      <p class="hint">
        Everything this trip needs is in place. Nothing here is a reminder to tick — each line
        watches the trip's own details.
      </p>
    {/if}
  </section>
{/if}

{#if booking}
  <BookNeed {trip} need={booking} onClose={() => (booking = null)} onDone={(m) => (status = m)} />
{/if}

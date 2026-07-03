<script lang="ts">
  import { untrack } from 'svelte';
  import type { Trip } from '../../lib/db';
  import { renderPlan } from '../../lib/markdown';
  import { computeCountdown } from '../../lib/countdown';
  import { updateTrip } from '../../lib/trips';
  import JournalView from '../JournalView.svelte';

  let { trip }: { trip: Trip } = $props();

  let editing = $state(false);
  let draft = $state('');

  const hasJournal = $derived((trip.journalText ?? '').trim() !== '');

  // Past trips with a journal open on the journal — the trip's record of
  // itself — with the plan one tap away. Everything else opens on the plan.
  let view = $state<'plan' | 'journal'>(
    untrack(() => (trip.status === 'done' && (trip.journalText ?? '').trim() ? 'journal' : 'plan')),
  );

  const rendered = $derived(trip.planText.trim() ? renderPlan(trip.planText) : null);

  // Live departure countdown, ticking once a second while a return time is set.
  let now = $state(Date.now());
  $effect(() => {
    if (!trip.returnFlightAt) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const target = $derived(trip.returnFlightAt ? new Date(trip.returnFlightAt).getTime() : null);
  const countdown = $derived(
    target && !Number.isNaN(target) ? computeCountdown(target, now) : null,
  );

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void updateTrip(trip.id, { planText: draft }), 400);
  }

  function startEdit() {
    draft = trip.planText;
    view = 'plan';
    editing = true;
  }

  async function done() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await updateTrip(trip.id, { planText: draft });
    editing = false;
  }

  function scrollTo(slug: string) {
    document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<div class="plan">
  {#if countdown && trip.status !== 'done'}
    <div class="countdown" class:countdown--expired={countdown.expired}>
      <span class="countdown-label">{countdown.expired ? 'Return flight' : 'Departure in'}</span>
      <span class="countdown-value">{countdown.expired ? 'Departed' : countdown.text}</span>
    </div>
  {/if}

  {#if editing}
    <label class="label" for="plan-text">Itinerary (Markdown)</label>
    <textarea
      id="plan-text"
      class="field plan-textarea"
      rows="18"
      placeholder="Paste the plan you generated in Claude…"
      bind:value={draft}
      oninput={scheduleSave}></textarea>
    <div class="save-bar">
      <button class="btn btn--primary" onclick={done}>Done</button>
      <span class="hint">Saved automatically as you type.</span>
    </div>
  {:else}
    {#if hasJournal || rendered}
      <div class="plan-toolbar">
        {#if hasJournal}
          <div class="segmented" role="tablist" aria-label="Plan or journal">
            <button
              class="segment"
              class:segment--on={view === 'journal'}
              role="tab"
              aria-selected={view === 'journal'}
              onclick={() => (view = 'journal')}>Journal</button
            >
            <button
              class="segment"
              class:segment--on={view === 'plan'}
              role="tab"
              aria-selected={view === 'plan'}
              onclick={() => (view = 'plan')}>Plan</button
            >
          </div>
        {/if}
        {#if view === 'plan'}
          <a class="btn btn--ghost" href={`#/trip/${trip.id}/prompt`}>Research prompt</a>
          <button class="btn btn--ghost" onclick={startEdit}>Edit plan</button>
        {/if}
      </div>
    {/if}

    {#if view === 'journal' && hasJournal}
      <JournalView {trip} />
    {:else if rendered}
      {#if rendered.toc.length > 1}
        <nav class="toc card" aria-label="Contents">
          <span class="section-title">Contents</span>
          {#each rendered.toc as item (item.slug)}
            <button
              class="toc-item"
              style={`--toc-depth:${item.depth}`}
              onclick={() => scrollTo(item.slug)}>{item.text}</button
            >
          {/each}
        </nav>
      {/if}
      <article class="prose">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised in renderPlan() -->
        {@html rendered.html}
      </article>
    {:else}
      <div class="card empty-state">
        <p class="empty-title">No plan yet</p>
        <p class="hint">
          Build a research prompt from this trip's details, run it in Claude, then paste the result
          here. It renders cleanly offline, and the Stops tab can extract the route automatically.
        </p>
        <div class="cluster">
          <a class="btn btn--primary" href={`#/trip/${trip.id}/prompt`}>Build research prompt</a>
          <button class="btn btn--ghost" onclick={startEdit}>Paste plan</button>
        </div>
      </div>
    {/if}
  {/if}
</div>

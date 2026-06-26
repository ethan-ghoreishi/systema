<script lang="ts">
  import type { Trip } from '../../lib/db';
  import { renderPlan } from '../../lib/markdown';
  import { computeCountdown } from '../../lib/countdown';
  import { updateTrip } from '../../lib/trips';

  let { trip }: { trip: Trip } = $props();

  let editing = $state(false);
  let draft = $state('');

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
  {#if countdown}
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
  {:else if rendered}
    <div class="plan-toolbar">
      <button class="btn btn--ghost" onclick={startEdit}>Edit plan</button>
    </div>
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
        Paste the itinerary you generated in Claude. It renders cleanly offline with an auto
        contents list. You can edit it any time.
      </p>
      <button class="btn btn--primary" onclick={startEdit}>Add plan</button>
    </div>
  {/if}
</div>

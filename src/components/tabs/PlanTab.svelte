<script lang="ts">
  import { untrack } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db, type Trip } from '../../lib/db';
  import { renderPlan } from '../../lib/markdown';
  import { splitPlanByCity } from '../../lib/headings';
  import { updateTrip } from '../../lib/trips';
  import { recall, remember } from '../../lib/ui-memory';
  import JournalView from '../JournalView.svelte';
  import NextDeparture from '../NextDeparture.svelte';

  let { trip }: { trip: Trip } = $props();

  const citiesQ = liveQuery(() => db.cities.where('tripId').equals(trip.id).sortBy('order'));
  const cities = $derived($citiesQ ?? []);

  type Field = 'planText' | 'journalText';
  let editing = $state<Field | null>(null);
  let draft = $state('');

  const hasJournal = $derived((trip.journalText ?? '').trim() !== '');

  // Past trips with a journal open on the journal — the trip's record of
  // itself — with the plan one tap away. Everything else opens on the plan.
  const viewKey = untrack(() => `plan:${trip.id}:view`);
  let view = $state<'plan' | 'journal'>(
    recall(
      viewKey,
      untrack(() =>
        trip.status === 'done' && (trip.journalText ?? '').trim() ? 'journal' : 'plan',
      ),
    ),
  );
  $effect(() => remember(viewKey, view));
  const showing = $derived(view === 'journal' && hasJournal ? 'journal' : 'plan');

  // A multi-city plan (one `# City` block per city) can be filtered to one city
  // at a time — separate spaces, and a shorter contents list for long plans.
  const citySegments = $derived(splitPlanByCity(trip.planText));
  const multiCityPlan = $derived(citySegments.length > 1);
  const filterKey = untrack(() => `plan:${trip.id}:city`);
  let cityFilter = $state<string | null>(recall(filterKey, null));
  $effect(() => remember(filterKey, cityFilter));
  const shownMarkdown = $derived(
    multiCityPlan && cityFilter
      ? (citySegments.find((s) => s.city === cityFilter)?.text ?? trip.planText)
      : trip.planText,
  );
  const rendered = $derived(shownMarkdown.trim() ? renderPlan(shownMarkdown) : null);

  // Emptying a journal is a deliberate act, not a keystroke: autosave leaves
  // the saved one alone until Done confirms it (as the Export tab does).
  const clearingJournal = $derived(
    editing === 'journalText' && !draft.trim() && (trip.journalText ?? '').trim() !== '',
  );

  let saveError = $state('');
  async function scheduleSave(force = false) {
    if (clearingJournal && !force) return true;
    try {
      await updateTrip(
        trip.id,
        editing === 'journalText' ? { journalText: draft } : { planText: draft },
      );
      saveError = '';
      return true;
    } catch (err) {
      saveError = `Not saved: ${err instanceof Error ? err.message : String(err)}. Copy your text before leaving.`;
      return false;
    }
  }

  // The text when this edit began: autosave is per keystroke, so this is the
  // way back from an accidental select-all-and-paste.
  let original = $state('');
  async function undoEdits() {
    const what = editing === 'journalText' ? 'journal' : 'plan';
    if (confirm(`Undo every change made since you started editing this ${what}?`)) {
      draft = original;
      await scheduleSave();
    }
  }

  function startEdit(field: Field) {
    const text = (field === 'journalText' ? trip.journalText : trip.planText) ?? '';
    original = text;
    draft = text;
    if (field === 'planText') view = 'plan';
    editing = field;
  }

  async function done() {
    if (
      clearingJournal &&
      !confirm('Clear the saved journal for this trip? This also clears it on your synced devices.')
    )
      return;
    if (await scheduleSave(clearingJournal)) editing = null;
  }

  function scrollTo(slug: string) {
    document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<div class="plan">
  {#if trip.status !== 'done'}
    <NextDeparture {trip} {cities} />
  {/if}

  {#if editing}
    <label class="label" for="plan-text"
      >{editing === 'journalText' ? 'Journal (Markdown)' : 'Itinerary (Markdown)'}</label
    >
    <textarea
      id="plan-text"
      class="field plan-textarea"
      rows="18"
      placeholder={editing === 'journalText'
        ? 'Write the journal, or paste the one Claude wrote…'
        : 'Paste the plan you generated in Claude…'}
      bind:value={draft}
      oninput={() => void scheduleSave()}></textarea>
    {#if editing === 'journalText'}
      <p class="hint">
        A line of its own like <code>[photo: P-3f9a1c]</code> shows that photograph there; the rest appear
        below the text. Leave the references as they are to keep the photographs in place.
      </p>
    {/if}
    {#if saveError}<p role="alert" class="hint hint--warn">{saveError}</p>{/if}
    <div class="save-bar">
      <button class="btn btn--primary" onclick={done}>Done</button>
      {#if draft !== original}
        <button class="btn btn--ghost" onclick={undoEdits}>Undo changes</button>
      {/if}
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
        {#if showing === 'plan'}
          <a class="btn btn--ghost" href={`#/trip/${trip.id}/prompt`}>Research prompt</a>
          <button class="btn btn--ghost" onclick={() => startEdit('planText')}>Edit plan</button>
        {:else}
          <button class="btn btn--ghost" onclick={() => startEdit('journalText')}
            >Edit journal</button
          >
        {/if}
      </div>
    {/if}

    {#if showing === 'journal'}
      <JournalView {trip} />
    {:else if rendered}
      {#if multiCityPlan}
        <div class="chips city-filter">
          <button
            class="chip"
            class:chip--on={cityFilter === null}
            onclick={() => (cityFilter = null)}>All cities</button
          >
          {#each citySegments as seg (seg.city)}
            <button
              class="chip"
              class:chip--on={cityFilter === seg.city}
              onclick={() => (cityFilter = seg.city)}>{seg.city}</button
            >
          {/each}
        </div>
      {/if}
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
          <button class="btn btn--ghost" onclick={() => startEdit('planText')}>Paste plan</button>
        </div>
      </div>
    {/if}
  {/if}
</div>

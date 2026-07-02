<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type PromptPrefs } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import { updateTrip } from '../lib/trips';
  import {
    buildResearchPrompt,
    defaultPromptPrefs,
    paceOptions,
    budgetOptions,
    interestOptions,
  } from '../lib/prompt';
  import { copyText, downloadText } from '../lib/download';

  let { id }: { id: string } = $props();

  const tripQ = liveQuery(async () => (await db.trips.get(id)) ?? null);
  const citiesQ = liveQuery(() => db.cities.where('tripId').equals(id).sortBy('order'));
  const trip = $derived($tripQ);
  const cities = $derived($citiesQ ?? []);

  // Local working copy: saved prefs win, otherwise defaults from the trip.
  let prefs = $state<PromptPrefs | null>(null);
  let loadedFor = $state<string | null>(null);
  $effect(() => {
    if (trip && loadedFor !== trip.id) {
      prefs = trip.promptPrefs
        ? { ...defaultPromptPrefs(trip, cities), ...trip.promptPrefs }
        : defaultPromptPrefs(trip, cities);
      loadedFor = trip.id;
    }
  });

  const promptText = $derived(prefs ? buildResearchPrompt(prefs) : '');

  let status = $state('');

  function toggleInterest(tag: string) {
    if (!prefs) return;
    prefs.interests = prefs.interests.includes(tag)
      ? prefs.interests.filter((t) => t !== tag)
      : [...prefs.interests, tag];
  }

  async function copyNow() {
    if (!prefs) return;
    // Persist the answers with the trip so they're remembered next time.
    await updateTrip(id, { promptPrefs: $state.snapshot(prefs) });
    const ok = await copyText(promptText);
    status = ok
      ? 'Prompt copied — paste it into Claude (or any LLM), then paste the plan it returns into the Plan tab.'
      : 'Copy failed — use download instead.';
  }

  function downloadNow() {
    downloadText('research-prompt.md', promptText, 'text/markdown');
    status = 'Prompt downloaded.';
  }
</script>

{#if trip && prefs}
  <div class="screen-frame">
    <TopBar title="Research prompt" back={`#/trip/${id}/plan`} />

    <div class="screen-body">
      <p class="hint">
        Answer a few questions and copy a ready-to-run prompt. It bakes in your standing profile
        (walking-first, coeliac-safe vegetarian grocery-first, London and Esfahan comparisons) and
        asks for a format this app imports automatically — the Stops tab will extract the route.
      </p>

      <div class="card">
        <div>
          <label class="label" for="p-dest">Destination</label>
          <input id="p-dest" class="field" bind:value={prefs.destination} />
        </div>

        <div class="cluster">
          <div class="grow">
            <label class="label" for="p-arrival">Arrival</label>
            <input
              id="p-arrival"
              class="field"
              placeholder="e.g. 20 June, 8:40am"
              bind:value={prefs.arrival}
            />
          </div>
          <div class="grow">
            <label class="label" for="p-departure">Departure</label>
            <input
              id="p-departure"
              class="field"
              placeholder="e.g. 22 June, 10:25pm"
              bind:value={prefs.departure}
            />
          </div>
        </div>

        <div>
          <label class="label" for="p-duration">Trip shape</label>
          <input id="p-duration" class="field" bind:value={prefs.durationLabel} />
        </div>

        <div>
          <span class="label">Pace</span>
          <div class="chips">
            {#each paceOptions as p (p)}
              <button
                class="chip"
                class:chip--on={prefs.pace === p}
                onclick={() => (prefs!.pace = p)}>{p}</button
              >
            {/each}
          </div>
        </div>

        <div>
          <span class="label">Budget</span>
          <div class="chips">
            {#each budgetOptions as b (b)}
              <button
                class="chip"
                class:chip--on={prefs.budget === b}
                onclick={() => (prefs!.budget = b)}>{b}</button
              >
            {/each}
          </div>
        </div>

        <div>
          <span class="label">Interests</span>
          <div class="chips">
            {#each interestOptions as tag (tag)}
              <button
                class="chip"
                class:chip--on={prefs.interests.includes(tag)}
                onclick={() => toggleInterest(tag)}>{tag}</button
              >
            {/each}
          </div>
        </div>

        <div class="field-row">
          <span class="label">Museums at most</span>
          <div class="stepper">
            <button
              class="btn btn--ghost stepper-btn"
              onclick={() => (prefs!.museumsMax = Math.max(0, prefs!.museumsMax - 1))}
              aria-label="Fewer museums">−</button
            >
            <span class="stepper-val">{prefs.museumsMax}</span>
            <button
              class="btn btn--ghost stepper-btn"
              onclick={() => (prefs!.museumsMax = Math.min(4, prefs!.museumsMax + 1))}
              aria-label="More museums">+</button
            >
          </div>
        </div>

        <div>
          <label class="label" for="p-companions">Companions</label>
          <input
            id="p-companions"
            class="field"
            placeholder="e.g. partner; mother staying with family nearby"
            bind:value={prefs.companions}
          />
        </div>

        <div>
          <label class="label" for="p-hotel">Base / hotel (optional)</label>
          <textarea id="p-hotel" class="field" rows="2" bind:value={prefs.hotel}></textarea>
        </div>

        <div>
          <label class="label" for="p-constraints">Hard constraints (optional)</label>
          <textarea id="p-constraints" class="field" rows="2" bind:value={prefs.constraints}
          ></textarea>
        </div>

        <div>
          <label class="label" for="p-past">Already visited before (optional)</label>
          <textarea
            id="p-past"
            class="field"
            rows="3"
            placeholder="Places from previous trips — used as context, not repeated as main stops."
            bind:value={prefs.pastVisits}></textarea>
        </div>

        <div>
          <label class="label" for="p-notes">Anything else (optional)</label>
          <textarea id="p-notes" class="field" rows="2" bind:value={prefs.notes}></textarea>
        </div>
      </div>

      <button class="btn btn--primary" onclick={copyNow}>Copy prompt</button>
      <button class="btn btn--ghost" onclick={downloadNow}>Download prompt (.md)</button>
      {#if status}<p class="hint hint--ok">{status}</p>{/if}

      <details class="pack-details">
        <summary>Preview prompt</summary>
        <pre class="pack-preview">{promptText}</pre>
      </details>
    </div>
  </div>
{/if}

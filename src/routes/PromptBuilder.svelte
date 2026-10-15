<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type PromptPrefs } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import { router, inTrip } from '../lib/router.svelte';
  import { scrollMemory } from '../lib/ui-memory';
  import { updateTrip } from '../lib/trips';
  import {
    buildCityPrompt,
    buildResearchPrompt,
    defaultPromptPrefs,
    paceOptions,
    budgetOptions,
    interestOptions,
    researchCities,
  } from '../lib/prompt';
  import { tripDisplayName, tripMetaLabel } from '../lib/trip-shape';
  import { cityBlock, replaceCityBlock } from '../lib/headings';
  import { importStopsFromPlan } from '../lib/stops';
  import { downloadText } from '../lib/download';
  import { copyText } from '../lib/copy.svelte';
  import PastePlanDialog from '../components/PastePlanDialog.svelte';

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

  const promptText = $derived(prefs && trip ? buildResearchPrompt(prefs, trip, cities) : '');

  // Multi-city: one prompt per city, researched and pasted in order.
  const phaseCities = $derived(researchCities(cities));
  const multi = $derived(phaseCities.length > 1);
  const names = $derived(phaseCities.map((c) => c.name));
  const stopsQ = liveQuery(() => db.stops.where('tripId').equals(id).toArray());
  const stopsByCity = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const s of $stopsQ ?? []) if (s.cityId) m[s.cityId] = (m[s.cityId] ?? 0) + 1;
    return m;
  });
  const hasPlan = (name: string) => !!trip && !!cityBlock(trip.planText, name, names);
  const nextCity = $derived(phaseCities.find((c) => !hasPlan(c.name))?.id);

  let status = $state('');
  let pasting = $state<{ cityId: string | null } | null>(null);

  function remember() {
    if (!prefs) return;
    void updateTrip(id, { promptPrefs: $state.snapshot(prefs) }).catch(() => {
      status = 'Copied, but your answers could not be saved for next time.';
    });
  }

  function copyCity(cityId: string, name: string) {
    if (!prefs || !trip) return;
    const copied = copyText(buildCityPrompt(prefs, trip, cities, cityId), `${name} prompt`);
    remember();
    void copied.then((ok) => {
      if (ok)
        status = `${name} prompt copied — paste it into Claude, then come back and paste ${name}'s plan.`;
    });
  }

  async function savePasted(cityId: string | null, text: string) {
    if (!trip) return;
    const city = cities.find((c) => c.id === cityId);
    const planText = city ? replaceCityBlock(trip.planText, city.name, text, names) : text;
    await updateTrip(id, { planText });
    const added = await importStopsFromPlan(id, planText, $stopsQ ?? [], cities);
    const what = city ? `${city.name}'s plan` : 'The plan';
    status = `${what} saved${added ? `, and ${added} stop${added > 1 ? 's' : ''} added to Stops` : ''}.`;
  }

  function toggleInterest(tag: string) {
    if (!prefs) return;
    prefs.interests = prefs.interests.includes(tag)
      ? prefs.interests.filter((t) => t !== tag)
      : [...prefs.interests, tag];
  }

  function copyNow() {
    if (!prefs) return;
    // Copy first, inside the tap: iOS refuses the clipboard after an await.
    const copied = copyText(promptText, 'Research prompt');
    // Then remember the answers with the trip, without holding up the copy.
    remember();
    void copied.then((ok) => {
      if (ok)
        status =
          'Prompt copied — paste it into Claude (or any LLM), then paste the plan it returns here.';
    });
  }

  function downloadNow() {
    downloadText('research-prompt.md', promptText, 'text/markdown');
    status = 'Prompt downloaded.';
  }
</script>

{#if trip && prefs}
  <div class="screen-frame">
    <TopBar title="Research prompt" onBack={() => router.back(`/trip/${id}/plan`, inTrip(id))} />

    <div class="screen-body" use:scrollMemory={router.path}>
      <p class="hint">
        Copy a ready-to-run prompt. It bakes in your standing profile (walking-first, coeliac-safe
        vegetarian grocery-first, London and Esfahan comparisons), the itinerary from your legs, and
        a format this app imports automatically — the Stops tab extracts the route.
      </p>

      <div class="card">
        <div class="prompt-trip">
          <span class="prompt-trip-name">{tripDisplayName(trip, cities)}</span>
          <span class="prompt-trip-meta"
            >{tripMetaLabel(trip, cities) || 'Add legs in Edit trip'}</span
          >
          <a class="hint" href={`#/trip/${id}/edit`}>Edit legs, dates &amp; cities →</a>
        </div>

        <div>
          <span class="label">Mode</span>
          <div class="chips">
            <button
              class="chip"
              class:chip--on={prefs.mode === 'plan'}
              onclick={() => (prefs!.mode = 'plan')}>Plan a new route</button
            >
            <button
              class="chip"
              class:chip--on={prefs.mode === 'have-plan'}
              onclick={() => (prefs!.mode = 'have-plan')}>I already have the plan</button
            >
          </div>
          <p class="hint">
            {#if prefs.mode === 'have-plan'}
              Enriches the itinerary you already have (paste it into the Plan tab first) into the
              app's format — it won't invent a new route. Best for past or pre-planned trips.
            {:else}
              Designs a fresh route from your legs, timings and profile.
            {/if}
          </p>
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

      {#if multi}
        <div class="card">
          <h2 class="section-title">City by city</h2>
          <p class="hint">
            One city at a time: each prompt carries only that city's hours, base and transfers, and
            each answer slots into the plan under its own heading.
          </p>
          {#each phaseCities as c, i (c.id)}
            {@const done = hasPlan(c.name)}
            <div class="phase" class:phase--next={c.id === nextCity}>
              <div class="phase-head">
                <span class="phase-no">{i + 1}</span>
                <span class="phase-name">{c.name}</span>
                <span class="hint"
                  >{done
                    ? `plan in${stopsByCity[c.id] ? ` · ${stopsByCity[c.id]} stops` : ''}`
                    : 'not researched yet'}</span
                >
              </div>
              <div class="cluster cluster--wrap">
                <button
                  class="btn btn--sm"
                  class:btn--primary={c.id === nextCity}
                  class:btn--ghost={c.id !== nextCity}
                  onclick={() => copyCity(c.id, c.name)}>Research {c.name}</button
                >
                <button class="btn btn--ghost btn--sm" onclick={() => (pasting = { cityId: c.id })}
                  >Paste {c.name} plan</button
                >
              </div>
            </div>
          {/each}
          {#if status}<p class="hint hint--ok" role="status">{status}</p>{/if}
        </div>

        <details class="pack-details">
          <summary>Or the whole trip in one prompt</summary>
          <div class="cluster cluster--wrap">
            <button class="btn btn--ghost" onclick={copyNow}>Copy whole-trip prompt</button>
            <button class="btn btn--ghost" onclick={downloadNow}>Download (.md)</button>
          </div>
          <pre class="pack-preview">{promptText}</pre>
        </details>
      {:else}
        <button class="btn btn--primary" onclick={copyNow}>Copy prompt</button>
        <button class="btn btn--ghost" onclick={() => (pasting = { cityId: null })}
          >Paste the plan Claude wrote</button
        >
        <button class="btn btn--ghost" onclick={downloadNow}>Download prompt (.md)</button>
        {#if status}<p class="hint hint--ok" role="status">{status}</p>{/if}

        <details class="pack-details">
          <summary>Preview prompt</summary>
          <pre class="pack-preview">{promptText}</pre>
        </details>
      {/if}
    </div>
  </div>

  {#if pasting}
    {@const city = cities.find((c) => c.id === pasting?.cityId)}
    <PastePlanDialog
      title={city ? `${city.name} plan` : 'Plan'}
      hint={city
        ? `Paste Claude's answer for ${city.name}. It replaces ${city.name}'s part of the plan; other cities stay as they are. New stops are added to Stops.`
        : trip.planText.trim()
          ? 'Paste the plan. It replaces the current plan (Edit plan on the Plan tab can undo it while editing). New stops are added to Stops.'
          : 'Paste the plan. New stops are added to Stops.'}
      onSave={(text) => savePasted(pasting!.cityId, text)}
      onClose={() => (pasting = null)}
    />
  {/if}
{/if}

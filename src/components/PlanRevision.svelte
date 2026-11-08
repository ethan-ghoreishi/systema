<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { City, Stop, Trip } from '../lib/db';
  import { extractStopsFromPlan } from '../lib/stops';
  import { planCityId, planMatches, planRetained, savePlanRevision } from '../lib/plan-revision';

  let {
    trip,
    cities,
    stops,
    initialText = '',
    previousText = trip.planText,
    onSaved,
    onClose,
  }: {
    trip: Trip;
    cities: City[];
    stops: Stop[];
    initialText?: string;
    previousText?: string;
    onSaved: () => void;
    onClose: () => void;
  } = $props();
  // A fixed review: any sync/write during it is detected in the transaction.
  const snapshot = untrack(() => ({
    trip: $state.snapshot(trip),
    cities: $state.snapshot(cities),
    stops: $state.snapshot(stops),
  }));
  let text = $state(untrack(() => initialText));
  let reviewing = $state(untrack(() => !!initialText.trim()));
  let matches = $state<string[]>(
    untrack(() =>
      planMatches(
        extractStopsFromPlan(
          initialText,
          snapshot.cities.map((c) => c.name),
        ),
        snapshot.stops,
        snapshot.cities,
      ),
    ),
  );
  let saving = $state(false);
  let error = $state('');
  let dialog: HTMLDialogElement;
  // Long routes are mostly unchanged: each place states what will happen to it,
  // and only the rows the traveller opens carry the full list of places.
  let openRows = $state<number[]>([]);
  const name = (s: string) => s.trim().toLocaleLowerCase();
  const cityName = (id: string | null | undefined) =>
    snapshot.cities.find((city) => city.id === id)?.name;
  const candidates = $derived(
    extractStopsFromPlan(
      text,
      snapshot.cities.map((c) => c.name),
    ),
  );
  const retained = $derived(planRetained(snapshot.stops, matches, previousText, snapshot.cities));
  const valid = $derived(new Set(matches.filter(Boolean)).size === matches.filter(Boolean).length);
  onMount(() => dialog.showModal());
  function review() {
    matches = planMatches(candidates, snapshot.stops, snapshot.cities);
    openRows = [];
    reviewing = true;
  }
  async function save() {
    saving = true;
    error = '';
    try {
      await savePlanRevision(
        snapshot.trip,
        text,
        candidates,
        matches,
        snapshot.stops,
        snapshot.cities,
        previousText,
      );
      onSaved();
      dialog.close();
    } catch (err) {
      error = `Not saved: ${err instanceof Error ? err.message : String(err)}. Your plan is still here.`;
    } finally {
      saving = false;
    }
  }
</script>

<dialog
  class="modal"
  aria-labelledby="revision-title"
  bind:this={dialog}
  onclose={onClose}
  oncancel={(e) => {
    if (saving) e.preventDefault();
  }}
>
  <div class="modal-sheet">
    <header class="modal-head">
      <button class="btn btn--ghost btn--sm" disabled={saving} onclick={() => dialog.close()}
        >Cancel</button
      >
      <h2 class="modal-title" id="revision-title">{reviewing ? 'Review Stops' : 'Paste plan'}</h2>
      {#if reviewing}
        <button class="btn btn--primary btn--sm" disabled={saving || !valid} onclick={save}
          >Apply plan</button
        >
      {:else}
        <button class="btn btn--primary btn--sm" disabled={!text.trim()} onclick={review}
          >Review Stops</button
        >
      {/if}
    </header>
    <div class="modal-body">
      {#if error}<p class="hint hint--warn" role="alert">{error}</p>{/if}
      {#if reviewing}
        <p class="hint">
          {candidates.length} places in the new order. Existing places keep their city, personal edits,
          visits, notes, checklists, corrected pins, bookings, photos and linked Moments. Unedited plan
          text updates.
        </p>
        {#each candidates as c, i (i)}
          {@const matched = snapshot.stops.find((s) => s.id === matches[i])}
          {@const matchedCity = cityName(matched?.cityId)}
          <div class="revision-row">
            {#if openRows.includes(i)}
              <label class="label" for={`match-${i}`}
                >{i + 1}. {c.name}{c.city ? ` · ${c.city}` : ''}</label
              >
            {:else}
              <span class="label">{i + 1}. {c.name}{c.city ? ` · ${c.city}` : ''}</span>
            {/if}
            <p class="hint">
              {matched
                ? `Keeps your record${matched.name === c.name ? '' : ` “${matched.name}”`}${matchedCity ? ` · ${matchedCity}` : ''}${matched.visited ? ' · visited' : ''}`
                : 'New place'}
            </p>
            {#if matched && matched.lat == null && matched.lng == null && c.lat != null && c.lng != null}
              <p class="hint">
                Missing map pin will be filled from the plan. Check its accuracy before navigating.
              </p>
            {/if}
            {#if matched && c.city && matchedCity && name(matchedCity) !== name(c.city)}
              <p class="hint hint--warn">
                This record belongs to {matchedCity} and stays there, even though the plan lists it under
                {c.city}. Match a place from {c.city} instead, or move it in Stops after applying.
              </p>
            {/if}
            {#if !matched && snapshot.cities.length && !planCityId(c, snapshot.cities)}
              <p class="hint">
                City is missing or ambiguous. This new place will be unassigned; choose its leg in
                Stops.
              </p>
            {/if}
            {#if openRows.includes(i)}
              <select class="field" id={`match-${i}`} bind:value={matches[i]} disabled={saving}>
                <option value="">Add as a new place</option>
                {#each snapshot.stops as s (s.id)}
                  <option value={s.id}
                    >{s.name}{cityName(s.cityId) ? ` · ${cityName(s.cityId)}` : ''} · keep this record</option
                  >
                {/each}
              </select>
            {:else}
              <button
                class="btn btn--ghost btn--sm"
                disabled={saving}
                aria-label={`${matched ? 'Change match' : 'Match an existing place'} for ${i + 1}. ${c.name}`}
                onclick={() => (openRows = [...openRows, i])}
                >{matched ? 'Change match' : 'Match an existing place'}</button
              >
            {/if}
          </div>
        {/each}
        {#if !valid}<p class="hint hint--warn" role="alert">
            Choose each existing place only once.
          </p>{/if}
        {#if candidates.length && retained.offRoute.length}
          <section aria-label="Kept off the route">
            <h3 class="section-title">Kept off the route</h3>
            <p class="hint">
              These stay available in Stops and Visited, with all their information. If a place was
              renamed, match it above.
            </p>
            <ul>
              {#each retained.offRoute as s (s.id)}<li>
                  {s.name}{s.visited ? ' · visited' : ''}
                </li>{/each}
            </ul>
          </section>
        {/if}
        {#if candidates.length && retained.personal.length}
          <section aria-label="Your own places, kept on the route">
            <h3 class="section-title">Your own places, kept on the route</h3>
            <p class="hint">
              Added by hand, so the plan does not drop them. Each stays with its own leg.
            </p>
            <ul>
              {#each retained.personal as s (s.id)}<li>
                  {s.name}{s.visited ? ' · visited' : ''}
                </li>{/each}
            </ul>
          </section>
        {/if}
        {#if !candidates.length}
          <p class="hint hint--warn" role="alert">
            No places recognised. Applying saves the text and keeps your existing route. Use a “##
            Route” section with one “### Place name” heading per stop.
          </p>
        {/if}
        <button class="btn btn--ghost" disabled={saving} onclick={() => (reviewing = false)}
          >Edit pasted text</button
        >
      {/if}
      <label class="label" for="revision-text"
        >{reviewing ? 'Plan text (for copying)' : 'Plan text'}</label
      >
      <textarea
        id="revision-text"
        class="field plan-textarea"
        bind:value={text}
        readonly={reviewing}
        disabled={saving}></textarea>
    </div>
  </div>
</dialog>

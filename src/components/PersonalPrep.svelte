<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type City, type Trip } from '../lib/db';
  import {
    GROUPS,
    GROUP_LABEL,
    ownPrepSuggestions,
    prepIsDue,
    prepItems,
    renameOwnPrep,
    setOwnPrep,
    setPrepDone,
    setPrepSkipped,
    type PrepGroup,
    type PrepItem,
  } from '../lib/prep';

  /**
   * Getting yourself ready: the food, the charging, the bag, the flat.
   *
   * Each line carries the fact about *this* trip that earned it, so a list
   * that does not fit is obvious at a glance rather than merely unticked — the
   * failing of the note it replaces, which was the last trip's list every time.
   *
   * And it is yours to change: a line that does not apply is put aside (kept,
   * so it comes back if the trip changes), a line of your own goes in the
   * section you choose and can be reworded, and anything you have added on a
   * previous trip is offered here in one tap.
   */
  let { trip, cities }: { trip: Trip; cities: City[] } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(t);
  });

  const tripsQ = liveQuery(() => db.trips.toArray());
  const suggestions = $derived(ownPrepSuggestions($tripsQ ?? [], trip.id));

  const due = $derived(prepIsDue(trip, cities, now));
  const all = $derived(prepItems(trip, cities));
  const items = $derived(all.filter((i) => !i.skipped));
  const aside = $derived(all.filter((i) => i.skipped));
  const left = $derived(items.filter((i) => !i.done).length);
  const groups = $derived(
    GROUPS.map((g) => [g, items.filter((i) => i.group === g)] as const).filter(
      ([, list]) => list.length,
    ),
  );

  // A step whose own step is still open says so in words. It is not disabled:
  // you may well have bought the food yesterday without ticking it.
  const waitingOn = (i: PrepItem) =>
    i.after && !items.find((x) => x.key === i.after)?.done ? i.afterLabel : '';

  let adding = $state(false);
  let text = $state('');
  let group = $state<PrepGroup>('other');
  let editing = $state<string | null>(null);
  let editText = $state('');

  async function add(line = text, into: PrepGroup = group) {
    await setOwnPrep(trip, line, true, into);
    text = '';
    adding = false;
  }

  async function saveRename(from: string) {
    await renameOwnPrep(trip, from, editText);
    editing = null;
  }
</script>

{#if trip.status !== 'done' && all.length}
  <section class="card prep" aria-labelledby="prep-title">
    <details open={due}>
      <summary class="card-head prep-summary">
        <span class="section-title" id="prep-title">Getting ready</span>
        <span class="before-count">{left ? `${left} to do` : 'All done'}</span>
      </summary>

      {#each groups as [g, list] (g)}
        <span class="section-title">{GROUP_LABEL[g]}</span>
        {#each list as item (item.key)}
          {#if editing === item.key}
            <div class="need">
              <input
                class="field"
                aria-label="Reword this line"
                bind:value={editText}
                onkeydown={(e) => e.key === 'Enter' && void saveRename(item.label)}
              />
              <button
                class="btn btn--primary btn--sm"
                onclick={() => void saveRename(item.label)}
                disabled={!editText.trim()}>Save</button
              >
              <button class="btn btn--ghost btn--sm" onclick={() => (editing = null)}>Cancel</button
              >
            </div>
          {:else}
            <div class="need" class:need--done={item.done}>
              <label class="need-tick">
                <input
                  type="checkbox"
                  checked={item.done}
                  onchange={() => void setPrepDone(trip, item.key, !item.done)}
                />
                <span class="need-main">
                  <span class="need-label">{item.label}</span>
                  <span class="need-detail"
                    >{waitingOn(item) ? `after “${waitingOn(item)}” — ` : ''}{item.because}</span
                  >
                </span>
              </label>
              {#if item.own}
                <button
                  class="btn btn--ghost btn--sm"
                  aria-label={`Reword ${item.label}`}
                  onclick={() => {
                    editing = item.key;
                    editText = item.label;
                  }}>Edit</button
                >
                <button
                  class="btn btn--ghost btn--sm"
                  aria-label={`Delete ${item.label}`}
                  onclick={() => void setOwnPrep(trip, item.label, false)}>Delete</button
                >
              {:else}
                <button
                  class="btn btn--ghost btn--sm"
                  aria-label={`Not for this trip: ${item.label}`}
                  onclick={() => void setPrepSkipped(trip, item.key, true)}>Skip</button
                >
              {/if}
            </div>
          {/if}
        {/each}
      {/each}

      {#if adding}
        <input
          class="field"
          type="text"
          aria-label="Something else to do"
          placeholder="Pick up the parcel"
          bind:value={text}
          onkeydown={(e) => e.key === 'Enter' && text.trim() && void add()}
        />
        <div class="chips" role="group" aria-label="Which section">
          {#each GROUPS as g (g)}
            <button class="chip chip--sm" class:chip--on={group === g} onclick={() => (group = g)}
              >{GROUP_LABEL[g]}</button
            >
          {/each}
        </div>
        <div class="cluster">
          <button
            class="btn btn--primary btn--sm"
            onclick={() => void add()}
            disabled={!text.trim()}>Add</button
          >
          <button class="btn btn--ghost btn--sm" onclick={() => (adding = false)}>Cancel</button>
        </div>
        {#if suggestions.length}
          <span class="section-title">From your other trips</span>
          <div class="chips">
            {#each suggestions.slice(0, 8) as s (s)}
              <button class="chip chip--sm" onclick={() => void add(s, 'other')}>+ {s}</button>
            {/each}
          </div>
        {/if}
      {:else}
        <button class="btn btn--ghost btn--sm" onclick={() => (adding = true)}>Add your own</button>
      {/if}

      {#if aside.length}
        <details class="before-done">
          <summary class="section-title">{aside.length} put aside</summary>
          {#each aside as item (item.key)}
            <div class="need need--done">
              <span class="need-main">
                <span class="need-label">{item.label}</span>
                <span class="need-detail">{item.because}</span>
              </span>
              {#if item.own}
                <button
                  class="btn btn--ghost btn--sm"
                  onclick={() => void setPrepSkipped(trip, item.key, false)}>Restore</button
                >
              {:else}
                <button
                  class="btn btn--ghost btn--sm"
                  onclick={() => void setPrepSkipped(trip, item.key, false)}>Bring back</button
                >
              {/if}
            </div>
          {/each}
        </details>
      {/if}

      {#if !due}
        <p class="hint">
          Still a while off — this is here early if you want it, and it comes forward on its own a
          week before you leave.
        </p>
      {/if}
    </details>
  </section>
{/if}

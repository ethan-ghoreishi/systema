<script lang="ts">
  import type { City, Trip } from '../lib/db';
  import {
    GROUPS,
    GROUP_LABEL,
    prepIsDue,
    prepItems,
    setOwnPrep,
    setPrepDone,
    type PrepItem,
  } from '../lib/prep';

  /**
   * Getting yourself ready: the food, the charging, the bag, the flat.
   *
   * Each line carries the fact about *this* trip that earned it, so a list
   * that does not fit is obvious at a glance rather than merely unticked — the
   * failing of the note it replaces, which was the last trip's list every time.
   */
  let { trip, cities }: { trip: Trip; cities: City[] } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(t);
  });

  const due = $derived(prepIsDue(trip, cities, now));
  const items = $derived(prepItems(trip, cities));
  const left = $derived(items.filter((i) => !i.done).length);
  const groups = $derived(
    GROUPS.map((g) => [g, items.filter((i) => i.group === g)] as const).filter(
      ([, list]) => list.length,
    ),
  );

  // A step whose own step is still open waits its turn: buy it, make it, take it.
  const blocked = (i: PrepItem) => !!i.after && !items.find((x) => x.key === i.after)?.done;

  let adding = $state(false);
  let text = $state('');
  async function add() {
    await setOwnPrep(trip, text, true);
    text = '';
    adding = false;
  }
</script>

{#if due && items.length}
  <section class="card before" aria-labelledby="prep-title">
    <div class="card-head">
      <span class="section-title" id="prep-title">Getting ready</span>
      <span class="before-count">{left ? `${left} to do` : 'All done'}</span>
    </div>

    {#each groups as [group, list] (group)}
      <span class="section-title">{GROUP_LABEL[group]}</span>
      {#each list as item (item.key)}
        <label class="need" class:need--done={item.done} class:need--waiting={blocked(item)}>
          <input
            type="checkbox"
            checked={item.done}
            onchange={() => void setPrepDone(trip, item.key, !item.done)}
          />
          <span class="need-main">
            <span class="need-label">{item.label}</span>
            <span class="need-detail"
              >{blocked(item) ? 'after the step above — ' : ''}{item.because}</span
            >
          </span>
          {#if item.own}
            <button
              class="btn btn--ghost btn--sm"
              onclick={(e) => {
                e.preventDefault();
                void setOwnPrep(trip, item.label, false);
              }}>Remove</button
            >
          {/if}
        </label>
      {/each}
    {/each}

    {#if adding}
      <input
        class="field"
        type="text"
        aria-label="Something else to do"
        placeholder="Pick up the parcel"
        bind:value={text}
      />
      <div class="cluster">
        <button class="btn btn--primary btn--sm" onclick={add} disabled={!text.trim()}>Add</button>
        <button class="btn btn--ghost btn--sm" onclick={() => (adding = false)}>Cancel</button>
      </div>
    {:else}
      <button class="btn btn--ghost btn--sm" onclick={() => (adding = true)}>Add your own</button>
    {/if}
  </section>
{/if}

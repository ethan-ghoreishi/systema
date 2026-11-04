<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type TripOption } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';
  import PastePlanDialog from '../components/PastePlanDialog.svelte';
  import OptionEditor from '../components/OptionEditor.svelte';
  import { router, navigate } from '../lib/router.svelte';
  import { scrollMemory, recall, remember } from '../lib/ui-memory';
  import { copyText } from '../lib/copy.svelte';
  import { buildOpportunityPrompt } from '../lib/prompt';
  import {
    SORT_LABEL,
    STALE_FARE_DAYS,
    describeDifference,
    fareWords,
    optionDates,
    optionLeg,
    optionRoute,
    pounds,
    safeLink,
    viewOpportunity,
    type OptionSort,
    type PricedOption,
  } from '../lib/options';
  import {
    chooseOption,
    deleteOpportunity,
    measuredFacts,
    putOption,
    removeOption,
    updateOpportunity,
  } from '../lib/opportunities';
  import { tripDisplayName } from '../lib/trip-shape';
  import { wallParts } from '../lib/tz';

  /**
   * One destination, and the realistic ways to reach it side by side.
   *
   * The finder has already ranked the world on cost per daylight hour. What it
   * cannot know is what Stansted, a hotel night or a transfer in this city have
   * actually cost *you* — so each figure is the finder's, re-priced against the
   * ledger, with every substitution and every assumption left standing shown in
   * plain words rather than folded into a score. An option typed from a Google
   * Flights search is added up from its own parts instead, and says so.
   *
   * Nothing here is thrown away by choosing. The options that lost, the dates
   * that have gone and what you learned about the place all stay: the next
   * search starts from them, and the trip links back here.
   */
  let { id }: { id: string } = $props();

  const oppQ = liveQuery(async () => (await db.opportunities.get(id)) ?? null);
  const tripsQ = liveQuery(() => db.trips.toArray());
  const citiesQ = liveQuery(() => db.cities.toArray());
  // Live, because a figure quoted from the ledger has to move with the ledger.
  const factsQ = liveQuery(() => measuredFacts());
  const opp = $derived($oppQ);
  const trips = $derived($tripsQ ?? []);
  const facts = $derived($factsQ ?? null);

  let sort = $state<OptionSort>(recall('opp:sort', 'cost') as OptionSort);
  $effect(() => remember('opp:sort', sort));

  const view = $derived(
    opp && facts
      ? viewOpportunity(opp, facts, sort)
      : { rows: [], best: null, past: [], pastCount: 0, mixedBasis: false },
  );

  // Chosen is per option, not per destination: a place you have been is a
  // place worth going back to, and the trip that was taken says nothing about
  // whether this week's fares are worth a look.
  const tripFor = (optionId: string) => trips.find((t) => t.optionId === optionId);
  const openTrip = $derived(trips.find((t) => t.opportunityId === id && t.status !== 'done'));
  const visited = $derived(
    !!opp &&
      ($citiesQ ?? []).some((c) => c.name.trim().toLowerCase() === opp.city.trim().toLowerCase()),
  );

  let status = $state('');
  let editingResearch = $state(false);
  let draft = $state('');
  let pasting = $state(false);
  let busy = $state(false);
  let editing = $state<{ option?: TripOption } | null>(null);

  function startResearch() {
    draft = opp?.research ?? '';
    editingResearch = true;
  }

  async function saveResearch(text: string) {
    await updateOpportunity(id, { research: text });
  }

  function copyResearchPrompt() {
    if (!opp) return;
    const airports = [
      ...new Set(view.rows.flatMap((r) => [r.option.outRoute.at(-1), r.option.backRoute[0]])),
    ].filter((a): a is string => !!a);
    const months = [
      ...new Set(
        view.rows.map((r) => {
          const p = wallParts(r.option.outDate);
          return p ? `${p.month} ${p.y}` : r.option.outDate;
        }),
      ),
    ];
    const copied = copyText(
      buildOpportunityPrompt(opp.city, opp.country, airports, months, visited),
      `${opp.city} research prompt`,
    );
    void copied.then((ok) => {
      if (ok)
        status = `Prompt copied — run it in your AI assistant, then paste the answer back into what you know about ${opp.city}.`;
    });
  }

  async function choose(row: PricedOption) {
    if (!opp || busy) return;
    busy = true;
    try {
      const { toFill } = await chooseOption(opp, row.option);
      // Staying put: the trip appears above as soon as it is written, and what
      // the finder's row could not say is worth reading before moving on.
      status = toFill.length
        ? `Trip created, with the times and airports the row gave. Still to add: ${toFill.join(', ')}.`
        : 'Trip created, with the times and airports the row gave.';
    } catch (err) {
      status = `Could not make the trip: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      busy = false;
    }
  }

  async function dropOption(row: PricedOption) {
    const taken = tripFor(row.option.id);
    if (
      !confirm(
        taken
          ? `Remove ${optionDates(row.option)} from the comparison? The trip made from it stays, but this record of why it was chosen goes.`
          : `Remove ${optionDates(row.option)} from the comparison?`,
      )
    )
      return;
    await removeOption(id, row.option.id);
    status = 'Option removed.';
  }

  async function removeIdea() {
    if (!opp) return;
    if (
      !confirm(
        `Delete ${opp.city}, its ${opp.options.length} option${opp.options.length === 1 ? '' : 's'} and what you know about it? Any trip already chosen from it stays.`,
      )
    )
      return;
    await deleteOpportunity(id);
    navigate('/', { replace: true });
  }

  const money = (n: number | null) => (n == null ? '—' : pounds(Math.round(n)));
</script>

{#snippet optionCard(row: PricedOption, live: boolean)}
  {@const o = row.option}
  {@const taken = tripFor(o.id)}
  <article class="card opt" class:opt--blocked={row.blockers.length || !live}>
    <header class="card-head">
      <span class="opt-dates">{optionDates(o)}</span>
      <span class="opt-total">{money(row.totalPP)}<small> each</small></span>
    </header>
    <p class="hint">Estimate for {row.party} {row.party === 1 ? 'person' : 'people'}.</p>
    {#if row.unknown.length}
      <p class="hint hint--warn">{row.unknown.join(' ')}</p>
      <p class="hint">Choose where you will sleep in Edit before choosing this trip.</p>
    {:else if row.totalPP == null}
      <p class="hint hint--warn">Cost not worked out yet.</p>
    {/if}

    {#if row.blockers.length}
      <p class="opt-route">{optionRoute(o)}</p>
      <p class="hint hint--warn">{row.blockers.join(' ')}</p>
    {:else}
      <ul class="opt-facts">
        <li class="status-row">
          <span class="status-key">Out</span>
          <span class="status-val">{optionLeg(o, 'out') || '—'}</span>
        </li>
        <li class="status-row">
          <span class="status-key">Back</span>
          <span class="status-val">{optionLeg(o, 'back') || '—'}</span>
        </li>
      </ul>
      <!-- The shape of the day, on one line: what the trip is actually like. -->
      <p class="opt-route">
        {[
          row.usableH != null ? `${row.usableH} h daylight` : '',
          row.leaveHome
            ? `leave ${row.leaveHome.time}${row.leaveHome.dayBefore ? ' the night before' : ''}`
            : '',
          row.homeBy ? `back ~${row.homeBy.time}${row.homeBy.dayAfter ? ' next day' : ''}` : '',
          o.overnight ?? '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {#if o.note}<p class="opt-route">{o.note}</p>{/if}

      {#if taken}
        <a class="opt-diff" href={`#/trip/${taken.id}/plan`}
          >Chosen — {tripDisplayName(
            taken,
            ($citiesQ ?? []).filter((c) => c.tripId === taken.id),
          )}</a
        >
      {:else if live && view.best && o.id !== view.best.option.id}
        <p class="opt-diff">{describeDifference(row, view.best)}</p>
      {:else if live && view.best}
        <p class="opt-diff opt-diff--best">{SORT_LABEL[sort]} here, using these estimates.</p>
      {/if}
      {#if row.totalPP != null && (row.assumed.length || row.adjustments.some( (a) => a.basis.includes('allowance'), ))}
        <p class="hint">Includes allowances. Check the cost breakdown before choosing.</p>
      {/if}

      {#if live && row.fareAgeDays != null && row.fareAgeDays >= STALE_FARE_DAYS}
        <p class="hint hint--warn">
          Fare last checked {row.fareAgeDays} days ago — worth looking again.
        </p>
      {/if}

      <details class="opt-work">
        <summary class="section-title"
          >{row.totalPP == null
            ? 'Cost details'
            : `Where ${money(row.totalPP)} comes from`}</summary
        >
        {#if fareWords(o)}
          <p class="hint">Fares: {fareWords(o)}.</p>
        {/if}
        {#if row.basis === 'parts'}
          <p class="hint">
            Added up from what you typed — {row.farePP == null
              ? 'no fares yet'
              : `${pounds(row.farePP)} of fares`} plus the transfers, nights and allowances below.
          </p>
        {:else if row.finderPP != null}
          <p class="hint">
            The search worked it out at {pounds(row.finderPP)} each; your own costs move it from there.
          </p>
        {/if}
        {#if row.adjustments.length}
          <ul class="opt-adjust">
            {#each row.adjustments as a (a.label)}
              <li class="status-row">
                <span class="status-key"
                  >{a.deltaPP >= 0 ? '+' : '−'}{pounds(
                    Math.abs(Math.round(a.deltaPP * 100) / 100),
                  )}</span
                >
                <span class="status-val">{a.label} — {a.basis}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="hint">
            Nothing in your ledger speaks to this one yet, so it stands as it came.
          </p>
        {/if}
        {#if row.assumed.length}
          <p class="hint">Still assumed: {row.assumed.join('; ')}.</p>
        {/if}
        {#if row.groundH}
          <p class="hint">{row.groundH} h on the ground in all.</p>
        {/if}
      </details>
    {/if}

    <div class="cluster cluster--wrap opt-actions">
      {#if live && !openTrip && !row.blockers.length}
        <button
          class="btn btn--primary btn--sm grow"
          onclick={() => choose(row)}
          disabled={busy || row.unknown.length > 0}>Choose this</button
        >
      {/if}
      <button class="btn btn--ghost btn--sm" onclick={() => (editing = { option: o })}>Edit</button>
      {#if safeLink(o.outLink)}<a
          class="btn btn--ghost btn--sm"
          href={safeLink(o.outLink)}
          target="_blank"
          rel="noreferrer">Re-check out</a
        >{/if}
      {#if safeLink(o.backLink)}<a
          class="btn btn--ghost btn--sm"
          href={safeLink(o.backLink)}
          target="_blank"
          rel="noreferrer">…and back</a
        >{/if}
      <button class="btn btn--ghost btn--sm" onclick={() => void dropOption(row)}>Remove</button>
    </div>
  </article>
{/snippet}

{#if opp === undefined}
  <div class="screen-frame">
    <TopBar title="…" onBack={() => router.back('/')} />
    <div class="screen-body"><p class="hint">Loading…</p></div>
  </div>
{:else if opp === null}
  <div class="screen-frame">
    <TopBar title="Considering" onBack={() => router.back('/')} />
    <div class="screen-body">
      <div class="card empty-state">
        <p class="empty-title">Not found</p>
        <a class="btn btn--ghost" href="#/" data-replace>Back to trips</a>
      </div>
    </div>
  </div>
{:else}
  <div class="screen-frame">
    <TopBar title={opp.city} onBack={() => router.back('/')}>
      {#snippet actions()}
        <button class="icon-btn" aria-label="Delete this idea" onclick={removeIdea}
          ><Icon name="trash" /></button
        >
      {/snippet}
    </TopBar>

    <div class="screen-body" use:scrollMemory={router.path}>
      {#if status}<p class="hint hint--ok" role="status">{status}</p>{/if}

      {#if openTrip}
        <a class="card opp-chosen" href={`#/trip/${openTrip.id}/plan`}>
          <span class="opp-chosen-label">Chosen</span>
          <span class="opp-chosen-name"
            >{tripDisplayName(
              openTrip,
              ($citiesQ ?? []).filter((c) => c.tripId === openTrip.id),
            )}</span
          >
          <span class="hint">The trip is where the planning happens now.</span>
        </a>
      {/if}

      {#if view.rows.length}
        {#if new Set(view.rows.map((r) => r.party)).size > 1}
          <p class="hint hint--warn">
            These estimates use different party sizes. Check each option's assumptions.
          </p>
        {/if}
        <div class="chips chips--sort">
          {#each Object.entries(SORT_LABEL) as [key, label] (key)}
            <button
              class="chip"
              class:chip--on={sort === key}
              onclick={() => (sort = key as OptionSort)}>{label}</button
            >
          {/each}
        </div>

        <p class="hint">
          Clock times are local to each airport. Leaving home assumes 45 min to the airport and 90
          min before the flight.
        </p>

        {#each view.rows as row (row.option.id)}
          {@render optionCard(row, true)}
        {/each}
      {:else}
        <div class="card empty-state">
          <p class="empty-title">Nothing still ahead</p>
          <p class="hint">
            {opp.options.length
              ? 'Every option here has been overtaken — they are kept below. What you know about the city is further down, and still true.'
              : 'Add a way of getting here from a Google Flights search, or bring in a Cheap-Trip Finder search from Home.'}
          </p>
        </div>
      {/if}

      <div class="cluster">
        <button class="btn btn--ghost" onclick={() => (editing = {})}>Add an option</button>
      </div>

      {#if view.past.length}
        <details class="opt-work">
          <summary class="section-title"
            >{view.past.length} option{view.past.length === 1 ? '' : 's'} whose dates have gone</summary
          >
          <p class="hint">
            Kept on purpose: what a trip here came to last time is the best guide to what it will
            come to next time.
          </p>
          {#each view.past as row (row.option.id)}
            {@render optionCard(row, false)}
          {/each}
        </details>
      {/if}

      <section class="card">
        <div class="card-head">
          <span class="section-title">What you know about {opp.city}</span>
        </div>
        {#if editingResearch}
          <textarea class="field plan-textarea" rows="10" bind:value={draft}></textarea>
          <div class="cluster">
            <button
              class="btn btn--primary"
              onclick={async () => {
                await saveResearch(draft);
                editingResearch = false;
              }}>Done</button
            >
            <button class="btn btn--ghost" onclick={() => (editingResearch = false)}>Cancel</button>
          </div>
        {:else}
          {#if opp.research?.trim()}
            <p class="opp-research">{opp.research}</p>
          {:else}
            <p class="hint">
              The transfer from the airport, anything closed on those dates, what has to be booked —
              the things that outlive any particular fare. Ask an AI assistant for them, or write
              your own.
            </p>
          {/if}
          <div class="cluster cluster--wrap">
            <button class="btn btn--ghost btn--sm" onclick={copyResearchPrompt}
              >Copy a prompt</button
            >
            <button class="btn btn--ghost btn--sm" onclick={() => (pasting = true)}
              >Paste an answer</button
            >
            <button class="btn btn--ghost btn--sm" onclick={startResearch}>Write it</button>
          </div>
        {/if}
      </section>
    </div>
  </div>

  {#if pasting}
    <PastePlanDialog
      title={`What you know about ${opp.city}`}
      hint="Paste the answer. It replaces what is here, so keep anything you want from it."
      onSave={saveResearch}
      onClose={() => (pasting = false)}
    />
  {/if}

  {#if editing}
    <OptionEditor
      option={editing.option}
      onSave={async (o) => {
        await putOption(id, o);
        status = editing?.option ? 'Option updated.' : 'Option added.';
      }}
      onClose={() => (editing = null)}
    />
  {/if}
{/if}

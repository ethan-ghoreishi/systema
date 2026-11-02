<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';
  import PastePlanDialog from '../components/PastePlanDialog.svelte';
  import { router, navigate } from '../lib/router.svelte';
  import { scrollMemory, recall, remember } from '../lib/ui-memory';
  import { copyText } from '../lib/copy.svelte';
  import { buildOpportunityPrompt } from '../lib/prompt';
  import {
    SORT_LABEL,
    STALE_FARE_DAYS,
    describeDifference,
    optionDates,
    optionRoute,
    pounds,
    viewOpportunity,
    type OptionSort,
    type PricedOption,
  } from '../lib/options';
  import {
    chooseOption,
    deleteOpportunity,
    measuredFacts,
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
   * plain words rather than folded into a score.
   */
  let { id }: { id: string } = $props();

  const oppQ = liveQuery(async () => (await db.opportunities.get(id)) ?? null);
  const tripsQ = liveQuery(() => db.trips.toArray());
  const citiesQ = liveQuery(() => db.cities.toArray());
  const opp = $derived($oppQ);
  const trips = $derived($tripsQ ?? []);

  let facts = $state<Awaited<ReturnType<typeof measuredFacts>> | null>(null);
  $effect(() => {
    void measuredFacts().then((f) => (facts = f));
  });

  let sort = $state<OptionSort>(recall('opp:sort', 'cost') as OptionSort);
  $effect(() => remember('opp:sort', sort));

  const view = $derived(
    opp && facts ? viewOpportunity(opp, facts, sort) : { rows: [], best: null, pastCount: 0 },
  );
  const chosenTrip = $derived(trips.find((t) => t.opportunityId === id));
  const visited = $derived(
    !!opp &&
      ($citiesQ ?? []).some((c) => c.name.trim().toLowerCase() === opp.city.trim().toLowerCase()),
  );

  let status = $state('');
  let editingResearch = $state(false);
  let draft = $state('');
  let pasting = $state(false);
  let busy = $state(false);

  function startResearch() {
    draft = opp?.research ?? '';
    editingResearch = true;
  }

  async function saveResearch(text: string) {
    await updateOpportunity(id, { research: text });
  }

  function askClaude() {
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
        status = `Prompt copied — run it in Claude, then paste the answer back into what you know about ${opp.city}.`;
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

      {#if chosenTrip}
        <a class="card opp-chosen" href={`#/trip/${chosenTrip.id}/plan`}>
          <span class="opp-chosen-label">Chosen</span>
          <span class="opp-chosen-name"
            >{tripDisplayName(
              chosenTrip,
              ($citiesQ ?? []).filter((c) => c.tripId === chosenTrip.id),
            )}</span
          >
          <span class="hint">The trip is where the planning happens now.</span>
        </a>
      {/if}

      {#if view.rows.length}
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
          Leave-home times assume 45 minutes to the airport and the usual 90 before the flight. The
          real journey goes on the trip once you choose.
        </p>

        {#each view.rows as row (row.option.id)}
          {@const o = row.option}
          <article class="card opt" class:opt--blocked={row.blockers.length}>
            <header class="card-head">
              <span class="opt-dates">{optionDates(o)}</span>
              <span class="opt-total">{money(row.totalPP)}<small> each</small></span>
            </header>
            <p class="opt-route">
              {optionRoute(o)}{#if o.outFlights}
                · {o.outFlights}{/if}
            </p>

            {#if row.blockers.length}
              <p class="hint hint--warn">{row.blockers.join(' ')}</p>
            {:else}
              <ul class="opt-facts">
                {#if o.outDep}
                  <li class="status-row">
                    <span class="status-key">Leave home</span>
                    <span class="status-val"
                      >{row.leaveHome?.time ?? '—'}{row.leaveHome?.dayBefore
                        ? ' the night before'
                        : ''}</span
                    >
                  </li>
                {/if}
                {#if row.usableH != null}
                  <li class="status-row">
                    <span class="status-key">Daylight there</span>
                    <span class="status-val"
                      >{row.usableH} h{#if row.groundH}<small>
                          of {row.groundH} h on the ground</small
                        >{/if}</span
                    >
                  </li>
                {/if}
                {#if row.homeBy}
                  <li class="status-row">
                    <span class="status-key">Home by</span>
                    <span class="status-val"
                      >about {row.homeBy.time}{row.homeBy.dayAfter ? ' the next day' : ''}</span
                    >
                  </li>
                {/if}
                {#if o.overnight}
                  <li class="status-row">
                    <span class="status-key">Night</span><span class="status-val"
                      >{o.overnight}</span
                    >
                  </li>
                {/if}
              </ul>

              {#if view.best && row.option.id !== view.best.option.id}
                <p class="opt-diff">{describeDifference(row, view.best)}</p>
              {:else if view.best}
                <p class="opt-diff opt-diff--best">
                  {SORT_LABEL[sort]} here, once your own costs are used.
                </p>
              {/if}

              {#if row.fareAgeDays != null && row.fareAgeDays >= STALE_FARE_DAYS}
                <p class="hint hint--warn">
                  Fare last checked {row.fareAgeDays} days ago — worth looking again before deciding.
                </p>
              {/if}

              <details class="opt-work">
                <summary class="section-title">How this figure was reached</summary>
                {#if row.finderPP != null}
                  <p class="hint">
                    The finder worked it out at {pounds(row.finderPP)} each (fares {row.farePP ==
                    null
                      ? 'unknown'
                      : pounds(row.farePP)}, plus its own transfer, hotel and sundry allowances).
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
                  <p class="hint">
                    Still assumed, because nothing here measures it: {row.assumed.join('; ')}.
                  </p>
                {/if}
                <div class="cluster">
                  {#if o.outLink}<a
                      class="btn btn--ghost btn--sm"
                      href={o.outLink}
                      target="_blank"
                      rel="noreferrer">Re-check the fare out</a
                    >{/if}
                  {#if o.backLink}<a
                      class="btn btn--ghost btn--sm"
                      href={o.backLink}
                      target="_blank"
                      rel="noreferrer">…and back</a
                    >{/if}
                </div>
              </details>

              {#if !chosenTrip}
                <button class="btn btn--primary" onclick={() => choose(row)} disabled={busy}
                  >Choose this</button
                >
              {/if}
            {/if}
          </article>
        {/each}
      {:else}
        <div class="card empty-state">
          <p class="empty-title">No dates still ahead</p>
          <p class="hint">
            {opp.options.length
              ? 'Every option here has been overtaken. What you know about the city is below, and still true — add a newer search when the time comes.'
              : 'Add a Cheap-Trip Finder search from Home to compare ways of getting here.'}
          </p>
        </div>
      {/if}

      {#if view.pastCount}
        <p class="hint">
          {view.pastCount} option{view.pastCount === 1 ? '' : 's'} with dates now past are hidden.
        </p>
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
              the things that outlive any particular fare. Ask Claude for them, or write your own.
            </p>
          {/if}
          <div class="cluster">
            <button class="btn btn--ghost" onclick={askClaude}>Ask Claude what to check</button>
            <button class="btn btn--ghost" onclick={() => (pasting = true)}>Paste the answer</button
            >
            <button class="btn btn--ghost" onclick={startResearch}>Write it myself</button>
          </div>
        {/if}
      </section>
    </div>
  </div>

  {#if pasting}
    <PastePlanDialog
      title={`What you know about ${opp.city}`}
      hint="Paste Claude's answer. It replaces what is here, so keep anything you want from it."
      onSave={saveResearch}
      onClose={() => (pasting = false)}
    />
  {/if}
{/if}

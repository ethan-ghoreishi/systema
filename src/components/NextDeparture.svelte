<script lang="ts">
  import type { City, DepartPlan, Trip } from '../lib/db';
  import {
    STAGE_LABEL,
    clockLabel,
    departuresIcs,
    nextDeparture,
    readiness,
    tripDepartures,
    type Departure,
  } from '../lib/readiness';
  import { deviceTz, wallLabel } from '../lib/tz';
  import { updateCity, updateTrip } from '../lib/trips';
  import { downloadBlob, shareOrDownload } from '../lib/download';
  import { tripDisplayName } from '../lib/trip-shape';
  import DepartureEditor from './DepartureEditor.svelte';

  /**
   * "Next departure": the next airport or station departure that hasn't
   * happened — not the final flight home — with a leave-by time in plain
   * words. It refreshes once a minute; there is no ticking clock.
   */
  let { trip, cities }: { trip: Trip; cities: City[] } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    const wake = () => (now = Date.now());
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  });

  const deps = $derived(tripDepartures(trip, cities));
  const next = $derived(nextDeparture(deps, now));
  const later = $derived(next ? deps.filter((d) => d.at > next.at) : []);
  const words = $derived(next ? readiness(next, now, deviceTz()) : null);

  let editing = $state<Departure | null>(null);
  let note = $state('');

  function baseName(d: Departure): string {
    return cities.find((c) => c.id === d.cityId)?.base?.name ?? '';
  }

  async function saveDeparture(d: Departure, wall: string, plan: DepartPlan) {
    if (d.key === 'outbound') {
      // The plan replaces what was stored rather than being laid over it: the
      // editor started from the stored one, so merging would bring back every
      // field just emptied — a coach reference written into the flight's slot
      // could never be taken out again.
      await updateTrip(trip.id, { outbound: { ...plan, at: wall } });
    } else {
      await updateCity(d.key, { departure: wall, exit: plan });
    }
  }

  function icsFile(): File {
    const text = departuresIcs(trip.id, tripDisplayName(trip, cities), deps, Date.now());
    return new File([text], 'systema-departures.ics', { type: 'text/calendar' });
  }

  function addToCalendar() {
    downloadBlob('systema-departures.ics', icsFile());
    note =
      'Calendar file saved: open it to add a "get ready" and a "leave now" alert per departure.';
  }

  function shareIcs() {
    void shareOrDownload(icsFile());
  }
</script>

{#if next && words}
  {@const journey = `${next.from === 'home' ? 'Home' : next.from} → ${next.to}`}
  <section class="card depart depart--{words.stage}" aria-label="Next departure">
    <div class="depart-head">
      <span class="section-title">Next departure · {journey}</span>
      <span class="depart-stage">{STAGE_LABEL[words.stage]}</span>
    </div>
    <p class="depart-title">{words.title}</p>
    <p class="hint">{words.detail}</p>
    <p class="depart-facts">
      {next.plan.number ? `${next.plan.number} · ` : ''}departs {wallLabel(next.wall)}{next.plan
        .terminal
        ? ` · T${next.plan.terminal}`
        : ''}
    </p>
    <div class="cluster cluster--wrap">
      <!-- Named, because the card shows two journeys and the button only ever
           changed this one. -->
      <button class="btn btn--ghost btn--sm" onclick={() => (editing = next)}
        >Adjust {journey}</button
      >
      <button class="btn btn--ghost btn--sm" onclick={addToCalendar}>Calendar reminders</button>
      {#if 'share' in navigator}
        <button class="btn btn--ghost btn--sm" onclick={shareIcs}>Share…</button>
      {/if}
    </div>
    {#if note}<p class="hint" role="status">{note}</p>{/if}
    {#if later.length}
      <details class="depart-later">
        <summary>After this one: {later.length} more departure{later.length > 1 ? 's' : ''}</summary
        >
        {#each later as d (d.key)}
          <button class="depart-row" onclick={() => (editing = d)}>
            <span class="hint"
              >{d.from === 'home' ? 'Home' : d.from} → {d.to} · leave by {clockLabel(
                d.leaveBy,
                d.tz,
                now,
              )}</span
            >
            <span>Adjust</span>
          </button>
        {/each}
      </details>
    {/if}
  </section>
{/if}

{#if editing}
  {@const d = editing}
  <DepartureEditor
    title={d.from === 'home' ? 'Leaving home' : `Leaving ${d.from}`}
    wall={d.wall}
    tz={d.tz}
    plan={d.plan}
    fromHint={baseName(d)}
    onSave={(wall, plan) => saveDeparture(d, wall, plan)}
    onClose={() => (editing = null)}
  />
{/if}

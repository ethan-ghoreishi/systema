<script lang="ts">
  import { liveQuery } from 'dexie';
  import {
    db,
    type City,
    type DepartPlan,
    type LegBase,
    type SleepKind,
    type TripStatus,
  } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';
  import CoverPicker from '../components/CoverPicker.svelte';
  import DepartureEditor from '../components/DepartureEditor.svelte';
  import {
    addCity,
    applyStopoverScenario,
    deleteCity,
    deleteTrip,
    moveCity,
    updateCity,
    updateTrip,
  } from '../lib/trips';
  import { commonCurrencies } from '../lib/currencies';
  import {
    STOPOVER_SCENARIOS,
    legBaseName,
    legIssues,
    stopoverNotes,
    stopoverShape,
    tripDays,
    tripDisplayName,
    tripHotelNights,
    tripMetaLabel,
    type StopoverScenario,
  } from '../lib/trip-shape';
  import { tripDepartures } from '../lib/readiness';
  import {
    HOME_TZ,
    allTimeZones,
    isValidTz,
    suggestTz,
    timeIn,
    tzLongName,
    wallLabel,
  } from '../lib/tz';
  import { router, inTrip, outsideTrip } from '../lib/router.svelte';
  import { scrollMemory } from '../lib/ui-memory';

  let { id }: { id: string } = $props();

  const tripQ = liveQuery(async () => (await db.trips.get(id)) ?? null);
  const citiesQ = liveQuery(() => db.cities.where('tripId').equals(id).sortBy('order'));
  const trip = $derived($tripQ);
  const cities = $derived($citiesQ ?? []);

  let newCityName = $state('');
  let newCityCurrency = $state('EUR');

  const sleepOptions: { v: SleepKind; label: string }[] = [
    { v: 'none', label: 'No overnight' },
    { v: 'airport', label: 'Airport' },
    { v: 'hotel', label: 'Hotel' },
  ];

  // Everything on this screen autosaves; the indicator makes that visible.
  let savedAt = $state<number | null>(null);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  function flashSaved() {
    savedAt = Date.now();
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (savedAt = null), 2000);
  }

  function patch(p: Parameters<typeof updateTrip>[1]) {
    void updateTrip(id, p).then(flashSaved);
  }

  // A refused leg save (departure before arrival) explains itself under the leg.
  // Saves are numbered: a slower earlier save that succeeds afterwards must not
  // clear a refusal that came after it.
  let legErrors = $state<Record<string, { message: string; seq: number }>>({});
  let saveSeq = 0;
  async function patchCity(cityId: string, p: Partial<City>, input?: HTMLInputElement) {
    const current = cities.find((x) => x.id === cityId) as Record<string, unknown> | undefined;
    // Nothing changed (e.g. a field re-blurred after a refused value was reset).
    if (
      current &&
      Object.entries(p).every(([k, v]) => JSON.stringify(current[k]) === JSON.stringify(v))
    )
      return;
    const seq = ++saveSeq;
    try {
      await updateCity(cityId, p);
      if ((legErrors[cityId]?.seq ?? 0) < seq) delete legErrors[cityId];
      flashSaved();
    } catch (err) {
      legErrors[cityId] = { message: err instanceof Error ? err.message : String(err), seq };
      // Show what is stored, not the refused value.
      const c = cities.find((x) => x.id === cityId);
      if (input && c) input.value = (c[input.name as 'arrival' | 'departure'] as string) ?? '';
    }
  }

  function patchBase(c: City, key: keyof LegBase, value: string) {
    const base: LegBase = { ...c.base, [key]: value.trim() || undefined };
    void patchCity(c.id, { base });
  }

  const issues = $derived(trip ? [...legIssues(trip, cities), ...stopoverNotes(trip, cities)] : []);
  const departures = $derived(trip ? tripDepartures(trip, cities) : []);
  const zones = allTimeZones();
  let zonePickerFor = $state<string | null>(null);

  async function addCityNow() {
    const name = newCityName.trim();
    if (!name) return;
    const currency = (newCityCurrency.trim() || 'EUR').toUpperCase();
    await addCity(id, name, currency);
    newCityName = '';
    newCityCurrency = 'EUR';
    flashSaved();
  }

  // ---- Departures (leaving home, and each leg) ----
  let editing = $state<{
    key: string;
    title: string;
    wall: string;
    tz?: string;
    plan: DepartPlan;
    from: string;
  } | null>(null);

  function editLegDeparture(c: City) {
    editing = {
      key: c.id,
      title: `Leaving ${c.name || 'this city'}`,
      wall: c.departure ?? '',
      tz: c.tz,
      plan: c.exit ?? {},
      from: trip ? legBaseName(trip, cities, c) : '',
    };
  }

  function editOutbound() {
    if (!trip) return;
    editing = {
      key: 'outbound',
      title: 'Leaving home',
      wall: trip.outbound?.at ?? '',
      tz: trip.outbound?.tz ?? HOME_TZ,
      plan: trip.outbound ?? {},
      from: 'home',
    };
  }

  async function saveDeparture(key: string, wall: string, plan: DepartPlan) {
    if (key === 'outbound') {
      await updateTrip(id, { outbound: { ...trip?.outbound, ...plan, at: wall || undefined } });
    } else {
      await updateCity(key, { departure: wall || undefined, exit: plan });
      delete legErrors[key];
    }
    flashSaved();
  }

  function leaveByFor(key: string): string {
    const d = departures.find((x) => x.key === key);
    return d ? `leave by ${timeIn(d.leaveBy, d.tz)}` : '';
  }

  // ---- Two-City Stopover ----
  const stopover = $derived(trip ? stopoverShape(trip, cities) : undefined);
  let scenario = $state<StopoverScenario>(1);
  let stopName = $state('');
  let stopCcy = $state('EUR');
  let destName = $state('');
  let destCcy = $state('EUR');
  let seededFor = $state('');
  $effect(() => {
    // Pre-fill from the legs once, when they're known.
    if (!trip || seededFor === trip.id || $citiesQ === undefined) return;
    seededFor = trip.id;
    if (stopover?.scenario) scenario = stopover.scenario;
    const byName = (n?: string) => cities.find((c) => c.name.trim() === n);
    const s = byName(stopover?.stopover) ?? cities[0];
    const d = byName(stopover?.destination) ?? cities.find((c) => c.id !== s?.id);
    stopName = s?.name ?? '';
    stopCcy = s?.currency ?? 'EUR';
    destName = d?.name ?? '';
    destCcy = d?.currency ?? 'EUR';
  });

  async function applyScenario() {
    if (!stopName.trim() || !destName.trim()) return;
    await applyStopoverScenario(
      id,
      scenario,
      { name: stopName, currency: stopCcy.toUpperCase() || 'EUR' },
      { name: destName, currency: destCcy.toUpperCase() || 'EUR' },
    );
    flashSaved();
  }

  /** Back to the trip screen you came from (its Plan after creating a trip). */
  function done() {
    router.back(`/trip/${id}/plan`, inTrip(id));
  }

  async function removeTrip() {
    if (
      confirm(
        'Delete this trip and all its cities, stops, photos and expenses? ' +
          'It is also removed from your other devices when they next sync. ' +
          'Only a backup file, or an older snapshot from the NAS share, can bring it back ' +
          '(Settings → Restore from a backup file). ' +
          'Tip: past trips can be kept instead by setting Status to Done.',
      )
    ) {
      await deleteTrip(id);
      router.back('/', outsideTrip(id));
    }
  }
</script>

{#if trip}
  <div class="screen-frame">
    <TopBar title="Edit trip" onBack={done} />

    <div class="screen-body" use:scrollMemory={router.path}>
      <div class="detail-bar">
        <span class="autosave" class:autosave--on={savedAt}>
          {savedAt ? 'Saved ✓' : 'Changes save automatically'}
        </span>
      </div>

      <!-- Live derived summary: name, shape and dates are worked out from the legs. -->
      <div class="card trip-summary">
        <span class="trip-summary-name">{tripDisplayName(trip, cities)}</span>
        <span class="trip-summary-meta">{tripMetaLabel(trip, cities) || 'Add a city to begin'}</span
        >
        {#if tripDays(trip, cities) > 0}
          <span class="trip-summary-sub">
            {tripDays(trip, cities)} day{tripDays(trip, cities) > 1
              ? 's'
              : ''}{#if tripHotelNights(trip, cities) > 0},
              {tripHotelNights(trip, cities)} hotel night{tripHotelNights(trip, cities) > 1
                ? 's'
                : ''}{/if}
          </span>
        {/if}
      </div>

      {#if trip.preset === 'two-city' || stopover}
        <div class="card">
          <h2 class="section-title">Two-City Stopover</h2>
          <p class="hint">
            Two cities in two days on one protected ticket: land by ~11:00, move on that evening
            (after ~18:00) or next morning (before ~10:00), home after ~18:00, one hotel night.
          </p>
          <div class="scenario-list" role="radiogroup" aria-label="Scenario">
            {#each [1, 2, 3, 4] as const as n (n)}
              <button
                class="scenario"
                class:scenario--on={scenario === n}
                role="radio"
                aria-checked={scenario === n}
                onclick={() => (scenario = n)}
              >
                <span class="scenario-no">{n}</span>
                <span class="scenario-text">{STOPOVER_SCENARIOS[n]}{n === 1 ? ' (ideal)' : ''}</span
                >
              </button>
            {/each}
          </div>
          <div class="leg-add">
            <input
              class="field"
              placeholder="Stopover city"
              aria-label="Stopover city"
              bind:value={stopName}
            />
            <input
              class="field city-ccy"
              aria-label="Stopover currency"
              list="ccy-list"
              bind:value={stopCcy}
            />
          </div>
          <div class="leg-add">
            <input
              class="field"
              placeholder="Destination"
              aria-label="Destination"
              bind:value={destName}
            />
            <input
              class="field city-ccy"
              aria-label="Destination currency"
              list="ccy-list"
              bind:value={destCcy}
            />
          </div>
          <button
            class="btn btn--primary"
            onclick={applyScenario}
            disabled={!stopName.trim() || !destName.trim()}
          >
            {cities.length ? 'Apply to the legs' : 'Set up the legs'}
          </button>
          <p class="hint">
            Puts the two cities in order, the hotel night where it falls, and marks the hop as part
            of the {scenario <= 2 ? 'outbound' : 'return'} ticket. Times you've entered stay.
          </p>
        </div>
      {/if}

      <div class="card">
        <h2 class="section-title">Leaving home</h2>
        {#if trip.outbound?.at}
          <button class="depart-row" onclick={editOutbound}>
            <span
              >{wallLabel(trip.outbound.at)} · {trip.outbound.hub || 'airport'}{trip.outbound.number
                ? ` · ${trip.outbound.number}`
                : ''}</span
            >
            <span class="hint">{leaveByFor('outbound')}</span>
          </button>
        {:else}
          <button class="btn btn--ghost" onclick={editOutbound}>Add your flight from home</button>
          <p class="hint">
            Gets you a calm "leave by" time for the airport, like every other departure.
          </p>
        {/if}
      </div>

      <div class="card">
        <h2 class="section-title">Legs</h2>
        <p class="hint">
          Each city in order, transit cities included, with times as printed on the tickets (each
          city's own clock). They set the trip's shape, dates and departures for you.
        </p>

        {#each cities as c, i (c.id)}
          {@const suggestion = !c.tz ? suggestTz(c.name, c.currency) : undefined}
          {@const legNotes = issues.filter((x) => x.cityId === c.id)}
          <div class="leg">
            <div class="leg-head">
              <span class="leg-no">{i + 1}</span>
              <input
                class="field leg-name"
                aria-label="City name"
                value={c.name}
                onchange={(e) =>
                  patchCity(c.id, { name: (e.currentTarget as HTMLInputElement).value })}
              />
              <input
                class="field city-ccy"
                aria-label="Currency"
                list="ccy-list"
                value={c.currency}
                onchange={(e) =>
                  patchCity(c.id, {
                    currency: (e.currentTarget as HTMLInputElement).value.toUpperCase(),
                  })}
              />
            </div>

            <div class="leg-times">
              <label class="leg-time">
                <span class="label">Arrival</span>
                <input
                  class="field"
                  type="datetime-local"
                  name="arrival"
                  value={c.arrival ?? ''}
                  max={c.departure || undefined}
                  onchange={(e) => {
                    const el = e.currentTarget as HTMLInputElement;
                    void patchCity(c.id, { arrival: el.value || undefined }, el);
                  }}
                />
              </label>
              <label class="leg-time">
                <span class="label">Departure</span>
                <input
                  class="field"
                  type="datetime-local"
                  name="departure"
                  value={c.departure ?? ''}
                  min={c.arrival || undefined}
                  onchange={(e) => {
                    const el = e.currentTarget as HTMLInputElement;
                    void patchCity(c.id, { departure: el.value || undefined }, el);
                  }}
                />
              </label>
            </div>

            <div class="leg-zone">
              {#if c.tz}
                <span class="hint">{tzLongName(c.tz)}</span>
                <button class="link-btn" onclick={() => (zonePickerFor = c.id)}>change</button>
              {:else if suggestion}
                <span class="hint">Times here are {tzLongName(suggestion)}?</span>
                <button
                  class="btn btn--ghost btn--sm"
                  onclick={() => patchCity(c.id, { tz: suggestion })}>Yes</button
                >
                <button class="link-btn" onclick={() => (zonePickerFor = c.id)}>other</button>
              {:else}
                <span class="hint">Times read in this phone's zone.</span>
                <button class="link-btn" onclick={() => (zonePickerFor = c.id)}>set the zone</button
                >
              {/if}
            </div>
            {#if zonePickerFor === c.id}
              <input
                class="field"
                list="tz-list"
                aria-label="Time zone"
                placeholder="e.g. Europe/Rome"
                value={c.tz ?? suggestion ?? ''}
                onchange={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value.trim();
                  if (isValidTz(v)) {
                    zonePickerFor = null;
                    void patchCity(c.id, { tz: v });
                  } else
                    legErrors[c.id] =
                      `“${v}” isn't a time zone this phone knows. Pick one from the list.`;
                }}
              />
            {/if}

            <div class="leg-foot">
              <div class="chips leg-sleep">
                {#each sleepOptions as opt (opt.v)}
                  <button
                    class="chip"
                    class:chip--on={(c.sleep ?? 'none') === opt.v}
                    onclick={() => patchCity(c.id, { sleep: opt.v })}>{opt.label}</button
                  >
                {/each}
              </div>
              <div class="leg-actions">
                <button
                  class="icon-btn icon-btn--sm"
                  aria-label="Move up"
                  disabled={i === 0}
                  onclick={() => moveCity(c.id, -1)}>↑</button
                >
                <button
                  class="icon-btn icon-btn--sm"
                  aria-label="Move down"
                  disabled={i === cities.length - 1}
                  onclick={() => moveCity(c.id, 1)}>↓</button
                >
                <button
                  class="icon-btn icon-btn--sm"
                  aria-label="Remove leg"
                  onclick={() => {
                    if (
                      confirm(
                        `Remove the ${c.name || 'unnamed'} leg? Its arrival, departure and overnight details go with it.`,
                      )
                    )
                      void deleteCity(c.id);
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </div>

            <details class="leg-base" open={c.sleep === 'hotel' && !c.base?.name}>
              <summary>
                Hotel / base{c.base?.name || legBaseName(trip, cities, c)
                  ? `: ${c.base?.name || legBaseName(trip, cities, c)}`
                  : ''}
              </summary>
              <input
                class="field"
                aria-label="Hotel or base name"
                placeholder={legBaseName(trip, cities, c) || 'Hotel, or where you leave your bag'}
                value={c.base?.name ?? ''}
                onchange={(e) => patchBase(c, 'name', (e.currentTarget as HTMLInputElement).value)}
              />
              <input
                class="field"
                aria-label="Address or area"
                placeholder="Address or area"
                value={c.base?.address ?? ''}
                onchange={(e) =>
                  patchBase(c, 'address', (e.currentTarget as HTMLInputElement).value)}
              />
              <div class="leg-times">
                <label class="leg-time">
                  <span class="label">Check-in</span>
                  <input
                    class="field"
                    type="datetime-local"
                    value={c.base?.checkIn ?? ''}
                    onchange={(e) =>
                      patchBase(c, 'checkIn', (e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <label class="leg-time">
                  <span class="label">Check-out</span>
                  <input
                    class="field"
                    type="datetime-local"
                    value={c.base?.checkOut ?? ''}
                    onchange={(e) =>
                      patchBase(c, 'checkOut', (e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
              </div>
            </details>

            <button class="depart-row" onclick={() => editLegDeparture(c)}>
              <span
                >{c.departure ? `Departs ${wallLabel(c.departure)}` : 'Departure plan'}{c.exit?.hub
                  ? ` · ${c.exit.hub}`
                  : ''}{c.exit?.throughTicket ? ' · protected connection' : ''}</span
              >
              <span class="hint">{leaveByFor(c.id) || 'add'}</span>
            </button>

            {#if legErrors[c.id]}<p role="alert" class="hint hint--warn">
                {legErrors[c.id].message}
              </p>{/if}
            {#each legNotes as n (n.message)}
              <p class="hint" class:hint--warn={n.kind !== 'pattern'}>{n.message}</p>
            {/each}
          </div>
        {/each}

        <div class="leg-add">
          <input class="field" placeholder="Add a city" bind:value={newCityName} />
          <input
            class="field city-ccy"
            aria-label="Currency"
            list="ccy-list"
            bind:value={newCityCurrency}
          />
          <button class="icon-btn" aria-label="Add city" onclick={addCityNow}>
            <Icon name="plus" />
          </button>
        </div>

        <datalist id="ccy-list">
          {#each commonCurrencies as ccy (ccy.code)}
            <option value={ccy.code}>{ccy.name}</option>
          {/each}
        </datalist>
        <datalist id="tz-list">
          {#each zones as z (z)}<option value={z}></option>{/each}
        </datalist>
      </div>

      <CoverPicker {trip} />

      <div class="card">
        <h2 class="section-title">Details</h2>

        <div>
          <label class="label" for="t-name">Custom name (optional)</label>
          <input
            id="t-name"
            class="field"
            placeholder={tripDisplayName({ ...trip, nameManual: '' }, cities)}
            value={trip.nameManual ?? ''}
            onchange={(e) => patch({ nameManual: (e.currentTarget as HTMLInputElement).value })}
          />
          <p class="hint">Leave blank to use the automatic name above.</p>
        </div>

        <div class="field-row">
          <span class="label">Party size</span>
          <div class="stepper">
            <button
              class="btn btn--ghost stepper-btn"
              onclick={() => patch({ partySize: Math.max(1, trip.partySize - 1) })}
              aria-label="Decrease party size">−</button
            >
            <span class="stepper-val">{trip.partySize}</span>
            <button
              class="btn btn--ghost stepper-btn"
              onclick={() => patch({ partySize: trip.partySize + 1 })}
              aria-label="Increase party size">+</button
            >
          </div>
        </div>

        <div>
          <label class="label" for="t-status">Status</label>
          <select
            id="t-status"
            class="field"
            value={trip.status}
            onchange={(e) =>
              patch({ status: (e.currentTarget as HTMLSelectElement).value as TripStatus })}
          >
            <option value="planning">Planning</option>
            <option value="active">Active</option>
            <option value="done">Done</option>
          </select>
        </div>
      </div>

      <div class="save-bar">
        <button class="btn btn--primary grow" onclick={done}>Done</button>
        <button class="btn btn--danger" onclick={removeTrip}>Delete trip</button>
      </div>
    </div>
  </div>

  {#if editing}
    {@const e = editing}
    <DepartureEditor
      title={e.title}
      wall={e.wall}
      tz={e.tz}
      plan={e.plan}
      fromHint={e.from}
      onSave={(wall, plan) => saveDeparture(e.key, wall, plan)}
      onClose={() => (editing = null)}
    />
  {/if}
{/if}

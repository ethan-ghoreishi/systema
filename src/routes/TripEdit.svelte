<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type SleepKind, type TripStatus } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';
  import CoverPicker from '../components/CoverPicker.svelte';
  import { addCity, deleteCity, deleteTrip, moveCity, updateCity, updateTrip } from '../lib/trips';
  import { commonCurrencies } from '../lib/currencies';
  import { tripDisplayName, tripMetaLabel, tripHotelNights, tripDays } from '../lib/trip-shape';
  import { navigate } from '../lib/router.svelte';

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

  function patchCity(cityId: string, p: Parameters<typeof updateCity>[1]) {
    void updateCity(cityId, p).then(flashSaved);
  }

  async function addCityNow() {
    const name = newCityName.trim();
    if (!name) return;
    await addCity(id, name, (newCityCurrency.trim() || 'EUR').toUpperCase());
    newCityName = '';
    newCityCurrency = 'EUR';
    flashSaved();
  }

  async function removeTrip() {
    if (
      confirm(
        'Delete this trip and all its cities, stops, photos and expenses from this device? ' +
          'This cannot be undone. ' +
          'Tip: past trips can be kept instead by setting Status to Done.',
      )
    ) {
      await deleteTrip(id);
      navigate('/');
    }
  }
</script>

{#if trip}
  <div class="screen-frame">
    <TopBar title="Edit trip" back={`#/trip/${id}/plan`} />

    <div class="screen-body">
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

      <div class="card">
        <h2 class="section-title">Legs</h2>
        <p class="hint">
          Add each city you'll be in, in order — transit cities included. Arrival, departure and
          where you slept set the trip's shape, dates and countdown for you.
        </p>

        {#each cities as c, i (c.id)}
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
                  value={c.arrival ?? ''}
                  onchange={(e) =>
                    patchCity(c.id, { arrival: (e.currentTarget as HTMLInputElement).value })}
                />
              </label>
              <label class="leg-time">
                <span class="label">Departure</span>
                <input
                  class="field"
                  type="datetime-local"
                  value={c.departure ?? ''}
                  onchange={(e) =>
                    patchCity(c.id, { departure: (e.currentTarget as HTMLInputElement).value })}
                />
              </label>
            </div>

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
                  onclick={() => deleteCity(c.id)}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </div>
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
        <a class="btn btn--primary grow" href={`#/trip/${id}/plan`}>Done</a>
        <button class="btn btn--danger" onclick={removeTrip}>Delete trip</button>
      </div>
    </div>
  </div>
{/if}

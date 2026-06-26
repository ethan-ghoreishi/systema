<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type TripStatus, type TripType } from '../lib/db';
  import TopBar from '../components/TopBar.svelte';
  import Icon from '../components/Icon.svelte';
  import { addCity, deleteCity, deleteTrip, updateCity, updateTrip } from '../lib/trips';
  import { tripPresets } from '../lib/presets';
  import { commonCurrencies } from '../lib/currencies';
  import { navigate } from '../lib/router.svelte';

  let { id }: { id: string } = $props();

  const tripQ = liveQuery(async () => (await db.trips.get(id)) ?? null);
  const citiesQ = liveQuery(() => db.cities.where('tripId').equals(id).sortBy('order'));
  const trip = $derived($tripQ);
  const cities = $derived($citiesQ ?? []);

  let newCityName = $state('');
  let newCityCurrency = $state('EUR');

  function patch(p: Parameters<typeof updateTrip>[1]) {
    void updateTrip(id, p);
  }

  async function addCityNow() {
    const name = newCityName.trim();
    if (!name) return;
    await addCity(id, name, (newCityCurrency.trim() || 'EUR').toUpperCase());
    newCityName = '';
    newCityCurrency = 'EUR';
  }

  async function removeTrip() {
    if (
      confirm('Delete this trip and all its cities, stops and expenses? This cannot be undone.')
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
      <div class="card">
        <div>
          <label class="label" for="t-name">Name</label>
          <input
            id="t-name"
            class="field"
            value={trip.name}
            onchange={(e) => patch({ name: (e.currentTarget as HTMLInputElement).value })}
          />
        </div>

        <div>
          <label class="label" for="t-type">Type</label>
          <select
            id="t-type"
            class="field"
            value={trip.type}
            onchange={(e) =>
              patch({ type: (e.currentTarget as HTMLSelectElement).value as TripType })}
          >
            {#each tripPresets as p (p.type)}
              <option value={p.type}>{p.label}</option>
            {/each}
          </select>
        </div>

        <div class="cluster">
          <div class="grow">
            <label class="label" for="t-start">Start</label>
            <input
              id="t-start"
              class="field"
              type="date"
              value={trip.startDate}
              onchange={(e) => patch({ startDate: (e.currentTarget as HTMLInputElement).value })}
            />
          </div>
          <div class="grow">
            <label class="label" for="t-end">End</label>
            <input
              id="t-end"
              class="field"
              type="date"
              value={trip.endDate}
              onchange={(e) => patch({ endDate: (e.currentTarget as HTMLInputElement).value })}
            />
          </div>
        </div>

        <div>
          <label class="label" for="t-return">Return flight (drives the countdown)</label>
          <input
            id="t-return"
            class="field"
            type="datetime-local"
            value={trip.returnFlightAt}
            onchange={(e) => patch({ returnFlightAt: (e.currentTarget as HTMLInputElement).value })}
          />
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

        <label class="switch">
          <input
            type="checkbox"
            checked={trip.accommodation}
            onchange={(e) =>
              patch({ accommodation: (e.currentTarget as HTMLInputElement).checked })}
          />
          <span>Accommodation</span>
        </label>

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

      <div class="card">
        <h2 class="section-title">Cities</h2>
        <p class="hint">
          Used for expense currency and the destination field. Add each city you'll visit (transit
          cities included).
        </p>

        {#each cities as c (c.id)}
          <div class="city-row">
            <input
              class="field"
              aria-label="City name"
              value={c.name}
              onchange={(e) =>
                updateCity(c.id, { name: (e.currentTarget as HTMLInputElement).value })}
            />
            <input
              class="field city-ccy"
              aria-label="Currency"
              list="ccy-list"
              value={c.currency}
              onchange={(e) =>
                updateCity(c.id, {
                  currency: (e.currentTarget as HTMLInputElement).value.toUpperCase(),
                })}
            />
            <button class="icon-btn" aria-label="Remove city" onclick={() => deleteCity(c.id)}>
              <Icon name="trash" />
            </button>
          </div>
        {/each}

        <div class="city-row">
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

      <button class="btn btn--danger" onclick={removeTrip}>Delete trip</button>
    </div>
  </div>
{/if}

<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type Trip } from '../../lib/db';
  import {
    buildTripPack,
    buildJournalingPrompt,
    buildMemoryPrompt,
    buildBackup,
    importBackup,
  } from '../../lib/export';
  import { buildTripCsv } from '../../lib/csv';
  import { tripDisplayName } from '../../lib/trip-shape';
  import { copyText, downloadText } from '../../lib/download';
  import { settingsStore } from '../../lib/settings.svelte';
  import { todayIso } from '../../lib/sheet';
  import { updateTrip } from '../../lib/trips';

  let { trip }: { trip: Trip } = $props();

  const stopsQ = liveQuery(() => db.stops.where('tripId').equals(trip.id).sortBy('order'));
  const citiesQ = liveQuery(() => db.cities.where('tripId').equals(trip.id).sortBy('order'));
  const expensesQ = liveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray());
  const photosQ = liveQuery(() => db.photos.where('tripId').equals(trip.id).toArray());
  const stops = $derived($stopsQ ?? []);
  const cities = $derived($citiesQ ?? []);
  const expenses = $derived($expensesQ ?? []);
  const allPhotos = $derived($photosQ ?? []);

  const pack = $derived(
    buildTripPack(
      trip,
      cities,
      stops,
      expenses,
      allPhotos.map((p) => ({ stopId: p.stopId, createdAt: p.createdAt })),
    ),
  );
  const prompt = $derived(buildJournalingPrompt(pack));

  let status = $state('');
  let busy = $state(false);

  // Journal paste-back: keeps the finished journal with the trip (Plan tab
  // grows a Plan | Journal toggle once saved).
  let journalDraft = $state('');
  let journalFor = $state<string | null>(null);
  $effect(() => {
    if (journalFor !== trip.id) {
      journalDraft = trip.journalText ?? '';
      journalFor = trip.id;
    }
  });

  async function saveJournal() {
    await updateTrip(trip.id, { journalText: journalDraft });
    status = journalDraft.trim() ? 'Journal saved — view it on the Plan tab.' : 'Journal cleared.';
  }

  function slug(): string {
    return (
      tripDisplayName(trip, cities)
        .toLowerCase()
        .replace(/[^\w]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'trip'
    );
  }

  async function copyPrompt() {
    const ok = await copyText(prompt);
    status = ok
      ? 'Journaling prompt copied — paste it into Claude.'
      : 'Copy failed — use download instead.';
  }

  function downloadPack() {
    downloadText(`${slug()}-trip-pack.md`, pack, 'text/markdown');
    status = 'Trip pack downloaded.';
  }

  async function copyMemoryPrompt() {
    const ok = await copyText(buildMemoryPrompt(trip, cities, stops, expenses));
    status = ok
      ? 'Reconstruction prompt copied — Claude interviews you first, then writes the journal. Paste the result back below.'
      : 'Copy failed.';
  }

  function downloadCsv() {
    downloadText(`${slug()}-expenses.csv`, buildTripCsv(expenses), 'text/csv');
    status = 'CSV downloaded — sheet column format, subtotal row included.';
  }

  async function downloadBackup() {
    busy = true;
    status = 'Building backup…';
    try {
      const backup = await buildBackup();
      downloadText(`systema-backup-${todayIso()}.json`, JSON.stringify(backup), 'application/json');
      status = 'Backup downloaded.';
    } finally {
      busy = false;
    }
  }

  async function onImport(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    busy = true;
    status = 'Importing…';
    try {
      const data = JSON.parse(await file.text());
      const r = await importBackup(data);
      await settingsStore.load();
      status = `Imported ${r.trips} trip(s), ${r.stops} stop(s), ${r.expenses} expense(s), ${r.photos} photo(s).`;
    } catch (err) {
      status = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="export">
  <div class="card">
    <h2 class="section-title">Journal this trip</h2>
    <p class="hint">
      Copy the prompt (it already includes the trip pack: plan, ticked stops, notes, photo counts
      and expense summary) and paste it into Claude to write your journal.
    </p>
    <button class="btn btn--primary" onclick={copyPrompt}>Copy journaling prompt</button>
    {#if trip.status === 'done' && !(trip.journalText ?? '').trim()}
      <button class="btn btn--ghost" onclick={copyMemoryPrompt}>
        Copy reconstruction prompt (pre-app trip)
      </button>
      <p class="hint">
        For trips from before the app: Claude uses the expense trail as a memory scaffold,
        interviews you, then writes the journal.
      </p>
    {/if}
    <button class="btn btn--ghost" onclick={downloadPack}>Download trip pack (.md)</button>
    <button class="btn btn--ghost" onclick={downloadCsv}>Download expenses (CSV)</button>
    <details class="pack-details">
      <summary>Preview trip pack</summary>
      <pre class="pack-preview">{pack}</pre>
    </details>
    <p class="hint">
      Photos are listed by stop and time, not embedded — an embedded pack would be too large to
      paste into a chat. Attach the photos themselves in Claude if you want them considered.
    </p>
  </div>

  <div class="card">
    <h2 class="section-title">Keep the journal</h2>
    <p class="hint">
      Paste the journal Claude wrote back here to keep it with the trip — it appears as a Journal
      view on the Plan tab, and past trips become a browsable trip journal on the home screen.
    </p>
    <textarea
      class="field"
      rows="6"
      placeholder="Paste the finished journal here…"
      bind:value={journalDraft}></textarea>
    <button class="btn btn--primary" onclick={saveJournal}>Save journal</button>
  </div>

  <div class="card">
    <h2 class="section-title">Backup &amp; transfer</h2>
    <p class="hint">
      A full JSON backup of all your data. Use it to move trips between devices — build the plan on
      your Mac, then import on the phone you'll travel with.
    </p>
    <button class="btn btn--ghost" onclick={downloadBackup} disabled={busy}>
      Download backup (JSON)
    </button>
    <label class="btn btn--ghost" class:btn--disabled={busy}>
      Import backup (JSON)
      <input
        type="file"
        accept="application/json,.json"
        hidden
        onchange={onImport}
        disabled={busy}
      />
    </label>
  </div>

  {#if status}<p class="hint hint--ok">{status}</p>{/if}
</div>

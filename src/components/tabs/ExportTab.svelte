<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type Trip } from '../../lib/db';
  import {
    buildTripPack,
    buildJournalingPrompt,
    buildBackup,
    importBackup,
  } from '../../lib/export';
  import { copyText, downloadText } from '../../lib/download';
  import { settingsStore } from '../../lib/settings.svelte';
  import { todayIso } from '../../lib/sheet';

  let { trip }: { trip: Trip } = $props();

  const stopsQ = liveQuery(() => db.stops.where('tripId').equals(trip.id).sortBy('order'));
  const expensesQ = liveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray());
  const photosQ = liveQuery(() => db.photos.where('tripId').equals(trip.id).toArray());
  const stops = $derived($stopsQ ?? []);
  const expenses = $derived($expensesQ ?? []);
  const allPhotos = $derived($photosQ ?? []);

  const photoCounts = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const p of allPhotos) if (p.stopId) m[p.stopId] = (m[p.stopId] ?? 0) + 1;
    return m;
  });

  const pack = $derived(buildTripPack(trip, stops, expenses, photoCounts));
  const prompt = $derived(buildJournalingPrompt(pack));

  let status = $state('');
  let busy = $state(false);

  function slug(): string {
    return (
      trip.name
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
    <button class="btn btn--ghost" onclick={downloadPack}>Download trip pack (.md)</button>
    <details class="pack-details">
      <summary>Preview trip pack</summary>
      <pre class="pack-preview">{pack}</pre>
    </details>
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

<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type Trip } from '../../lib/db';
  import {
    buildTripPack,
    buildJournalingPrompt,
    buildMemoryPrompt,
    photoManifest,
  } from '../../lib/export';
  import { photoExt } from '../../lib/photos';
  import { zip } from '../../lib/zip';
  import { buildTripCsv, csvNote } from '../../lib/csv';
  import { tripDisplayName } from '../../lib/trip-shape';
  import { downloadBlob, downloadText } from '../../lib/download';
  import { copyText } from '../../lib/copy.svelte';
  import { updateTrip } from '../../lib/trips';

  let { trip }: { trip: Trip } = $props();

  const stopsQ = liveQuery(() => db.stops.where('tripId').equals(trip.id).sortBy('order'));
  const citiesQ = liveQuery(() => db.cities.where('tripId').equals(trip.id).sortBy('order'));
  const expensesQ = liveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray());
  const photosQ = liveQuery(() => db.photos.where('tripId').equals(trip.id).toArray());
  const momentsQ = liveQuery(() => db.moments.where('tripId').equals(trip.id).toArray());
  const moments = $derived($momentsQ ?? []);
  const stops = $derived($stopsQ ?? []);
  const cities = $derived($citiesQ ?? []);
  const expenses = $derived($expensesQ ?? []);
  const allPhotos = $derived($photosQ ?? []);

  const packPhotos = $derived(
    allPhotos.map((p) => ({
      id: p.id,
      stopId: p.stopId,
      momentId: p.momentId,
      kind: p.kind,
      takenAt: p.takenAt,
      createdAt: p.createdAt,
    })),
  );
  const pack = $derived(
    buildTripPack({ trip, cities, stops, expenses, photos: packPhotos, moments }),
  );
  const manifest = $derived(photoManifest(packPhotos, stops, moments, cities));
  const prompt = $derived(buildJournalingPrompt(pack));

  let status = $state('');

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
    if (
      !journalDraft.trim() &&
      (trip.journalText ?? '').trim() &&
      !confirm('Clear the saved journal for this trip? This also clears it on your synced devices.')
    )
      return;
    try {
      await updateTrip(trip.id, { journalText: journalDraft });
      status = journalDraft.trim()
        ? 'Journal saved — view it on the Plan tab.'
        : 'Journal cleared.';
    } catch (err) {
      status = `Journal not saved: ${err instanceof Error ? err.message : String(err)}. Copy your text before leaving.`;
    }
  }

  function slug(): string {
    return (
      tripDisplayName(trip, cities)
        .toLowerCase()
        .replace(/[^\w]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'trip'
    );
  }

  function copyPrompt() {
    void copyText(prompt, 'Journaling prompt').then((ok) => {
      if (ok) status = 'Journaling prompt copied — paste it into Claude.';
    });
  }

  function downloadPack() {
    downloadText(`${slug()}-trip-pack.md`, pack, 'text/markdown');
    status = 'Trip pack downloaded.';
  }

  function copyMemoryPrompt() {
    const text = buildMemoryPrompt(trip, cities, stops, expenses);
    void copyText(text, 'Reconstruction prompt').then((ok) => {
      if (ok)
        status =
          'Reconstruction prompt copied — Claude interviews you first, then writes the journal. Paste the result back below.';
    });
  }

  /** The photos as files named in manifest order: 01-P-3f9a1c.jpg, … */
  function manifestFiles(): File[] {
    const byId = new Map(allPhotos.map((p) => [p.id, p]));
    return manifest.map((e) => {
      const p = byId.get(e.id)!;
      const n = String(e.n).padStart(2, '0');
      return new File([p.blob], `${n}-${e.ref}.${photoExt(p.blob)}`, { type: p.blob.type });
    });
  }

  function sharePhotos() {
    // Built synchronously so the share keeps the tap's permission.
    const files = manifestFiles();
    const nav = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean };
    if (nav.canShare?.({ files })) {
      void nav.share({ files }).then(
        () => (status = 'Shared — attach them to Claude in this order (they are numbered).'),
        () => {},
      );
      return;
    }
    void zip(files.map((f) => ({ name: f.name, data: f }))).then((blob) => {
      downloadBlob(`${slug()}-photos-for-claude.zip`, blob);
      status = 'Photos saved as a .zip, numbered in the order the prompt lists them.';
    });
  }

  function downloadCsv() {
    downloadText(`${slug()}-expenses.csv`, buildTripCsv(expenses), 'text/csv');
    status = `CSV downloaded — sheet column format, subtotal row included.${csvNote(expenses)}`;
  }
</script>

<div class="export">
  <div class="card">
    <h2 class="section-title">Journal this trip</h2>
    <p class="hint">
      Copy the prompt (it already includes the trip pack: plan, ticked stops, the visit order with
      your off-plan moments, the photo list and the expense summary) and paste it into Claude.
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
    {#if manifest.length}
      <details class="pack-details">
        <summary>Photo list for Claude ({manifest.length}, in the order to attach)</summary>
        <ol class="manifest">
          {#each manifest as e (e.id)}
            <li><code>{e.ref}</code> {[e.city, e.place].filter(Boolean).join(', ')}, {e.when}</li>
          {/each}
        </ol>
      </details>
      <button class="btn btn--ghost" onclick={sharePhotos}>
        Share the photos for Claude ({manifest.length}, in order)
      </button>
    {/if}
    <p class="hint">
      The prompt lists every photo with a reference (P-xxxxxx), where and when it was taken. Attach
      the photos themselves in Claude in the same order; Claude marks where each belongs, and the
      journal shows the real photographs there.
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

  <p class="hint">
    Full backups, restore and NAS sync between your devices live in
    <a href="#/settings">Settings</a>.
  </p>

  {#if status}<p class="hint hint--ok">{status}</p>{/if}
</div>

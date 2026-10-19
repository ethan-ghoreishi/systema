<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import { scrollMemory } from '../lib/ui-memory';
  import { router } from '../lib/router.svelte';
  import ConflictList from '../components/ConflictList.svelte';
  import { settingsStore } from '../lib/settings.svelte';
  import { db } from '../lib/db';
  import { connectivity } from '../lib/connectivity.svelte';
  import { nasBackup, type PhotoFailure } from '../lib/nas.svelte';
  import { backoffMs } from '../lib/nas-diagnostics';
  import { photoRef } from '../lib/photos';
  import { tripDisplayName } from '../lib/trip-shape';
  import { liveQuery } from 'dexie';
  import {
    buildZipBackup,
    importBackup,
    importNote,
    readBackupFile,
    type Backup,
    type ImportResult,
  } from '../lib/export';
  import { downloadBlob } from '../lib/download';
  import { todayIso } from '../lib/sheet';

  const s = settingsStore;
  const version = __APP_VERSION__;

  let persisted = $state<boolean | null>(null);
  let standalone = $state<boolean>(false);
  let canInstall = $state<boolean>(false);
  let deferredPrompt: any = null;

  // A secure (HTTPS) page cannot call an insecure (http://) endpoint.
  const nasUrlMixed = $derived(
    location.protocol === 'https:' && /^http:\/\//i.test(s.current.nasUrl.trim()),
  );

  onMount(() => {
    standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;

    if (navigator.storage?.persisted) {
      void navigator.storage.persisted().then((p) => (persisted = p));
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e;
      canInstall = true;
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  });

  async function requestPersist(): Promise<void> {
    if (navigator.storage?.persist) {
      persisted = await navigator.storage.persist();
    }
  }

  async function install(): Promise<void> {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    canInstall = false;
  }

  // ---- Backup health ----
  const when = (ms: number | null) =>
    ms
      ? new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
      : 'Never';
  let unsynced = $state<number | null>(null);
  let counted = 0;
  async function refreshUnsynced(): Promise<void> {
    const mine = ++counted;
    const n = await nasBackup.unsyncedChanges().catch(() => null);
    if (mine === counted) unsynced = n; // a slow earlier count never lands late
  }
  // Every sync records an attempt, so this recounts after the automatic ones
  // too — most changes are pushed by a sync nothing on this page started.
  $effect(() => {
    void nasBackup.lastAttempt;
    void refreshUnsynced();
  });

  let status = $state('');
  let busy = $state(false);
  async function run(label: string, task: () => Promise<string>): Promise<void> {
    busy = true;
    status = label;
    try {
      status = await task();
    } catch (err) {
      status = `Failed: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`;
    } finally {
      busy = false;
      void refreshUnsynced();
    }
  }

  const syncNow = () => run('Syncing…', async () => (await nasBackup.sync()).message);
  const retryFailed = () =>
    run('Uploading the failed photos…', async () => (await nasBackup.retryFailed()).message);
  const testConnection = () =>
    run('Testing the connection…', async () => {
      const r = await nasBackup.testConnection();
      return r.ok
        ? 'Connection test passed.'
        : 'Connection test found a problem — see the ✗ above.';
    });

  // The honest one-line state of the backup, never "normal" for a real fault.
  const failedList = $derived(Object.entries(nasBackup.failures).map(([id, f]) => ({ id, ...f })));
  const health = $derived.by((): { tone: 'ok' | 'warn' | 'calm'; text: string } => {
    const a = nasBackup.lastAttempt;
    const n = failedList.length;
    if (nasBackup.running) return { tone: 'calm', text: 'Syncing…' };
    if (!a) return { tone: 'calm', text: 'Not synced from this device yet.' };
    if (!a.ok) {
      const where = when(a.at);
      if (a.kind === 'offline' || a.kind === 'unreachable')
        return {
          tone: 'calm',
          text: `Couldn't reach the NAS (${where}). It retries by itself; if you're on the network it should be reachable from, Test connection.`,
        };
      return {
        tone: 'warn',
        text: `Last sync failed (${where}): ${nasBackup.lastError || a.message}`,
      };
    }
    if (n || a.partial)
      return {
        tone: 'warn',
        text: `Partly backed up: data saved ${when(nasBackup.lastSyncAt)}; ${n} photo${n === 1 ? '' : 's'} from this device not on the NAS.`,
      };
    return { tone: 'ok', text: `Backed up ${when(a.at)}.` };
  });
  const nextTry = (f: PhotoFailure) => {
    const at = f.lastAt + backoffMs(f.attempts);
    return at <= Date.now() ? 'on the next sync' : `after ${when(at)}`;
  };
  const tripsQ = liveQuery(() => db.trips.toArray());
  const citiesQ = liveQuery(() => db.cities.toArray());
  const tripName = (tripId: string) => {
    const t = ($tripsQ ?? []).find((x) => x.id === tripId);
    return t
      ? tripDisplayName(
          t,
          ($citiesQ ?? []).filter((c) => c.tripId === tripId),
        )
      : 'a trip';
  };
  const checkNas = () =>
    run(
      'Checking the NAS copy…',
      async () =>
        (await nasBackup.check((d, t) => (status = `Checking photos on the NAS… ${d}/${t}`)))
          .message,
    );
  const downloadFull = () =>
    run('Preparing backup…', async () => {
      const blob = await buildZipBackup((d, t) => (status = `Preparing backup… ${d}/${t} files`));
      downloadBlob(`systema-backup-${todayIso()}.zip`, blob);
      await nasBackup.recordFileBackup();
      return `Backup ready (${(blob.size / 1e6).toFixed(1)} MB). Save it in Files, somewhere off this device.`;
    });

  // ---- Restore from a file: check it, show what it would add, then confirm ----
  // Raw state: the backup must reach IndexedDB as plain data, not a proxy.
  let pending = $state.raw<{ backup: Backup; files: Map<string, Blob> } | null>(null);
  // Off by default: a restore adds, and only says otherwise when asked to.
  let fillEmpty = $state(false);
  const changes = (r: ImportResult) =>
    r.trips + r.stops + r.expenses + r.moments + r.photos + r.filled;
  const describe = (r: ImportResult, preview: boolean) =>
    changes(r) === 0
      ? `Everything in this backup is already on this device.${importNote(r)}`
      : `${preview ? 'This backup would add' : 'Added'} ${r.trips} trip(s), ${r.stops} stop(s), ${r.expenses} expense(s), ${r.moments ? `${r.moments} moment(s), ` : ''}${r.photos} photo(s).${importNote(r)}`;

  function inspect(file: Blob): Promise<void> {
    pending = null;
    return run('Checking the backup…', async () => {
      const read = await readBackupFile(
        file,
        (d, t) => (status = `Checking the backup… ${d}/${t}`),
      );
      const preview = await importBackup(read.backup, read.files, { dryRun: true, fillEmpty });
      if (changes(preview)) pending = read;
      return `Backup checked: intact. ${describe(preview, true)}`;
    });
  }

  const confirmImport = () =>
    run('Restoring…', async () => {
      const { backup, files } = pending!;
      const had = new Set(await db.trips.toCollection().primaryKeys());
      const r = await importBackup(backup, files, { fillEmpty });
      pending = null;
      // An older NAS snapshot carries photo metadata only: fetch the photos of
      // the trips it brought back from the NAS, where their files still are.
      const restored = new Set(backup.trips.map((t) => t.id).filter((id) => !had.has(id)));
      const metas = (backup.photosMeta ?? []).filter(
        (m) => restored.has(m.tripId) && !files.has(m.id),
      );
      if (metas.length && !(nasBackup.configured && navigator.onLine))
        return `${describe(r, false)} ${metas.length} photo(s) live only on the NAS: restore this file again when connected to it.`;
      const got = metas.length ? await nasBackup.restorePhotos(metas) : { fetched: 0, missing: [] };
      return `${describe(r, false)}${got.fetched ? ` ${got.fetched} photo(s) fetched from the NAS.` : ''}${got.missing.length ? ` ${got.missing.length} photo(s) this backup lists are not on the NAS — listed under Backup.` : ''}`;
    });

  async function onImportFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await inspect(file);
  }

  async function pasteImport(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) status = 'Clipboard is empty.';
      else await inspect(new Blob([text]));
    } catch {
      status = 'Could not read the clipboard — use the file import instead.';
    }
  }
</script>

<div class="screen-frame">
  <TopBar title="Settings" onBack={() => router.back('/')} />

  <div class="screen-body" use:scrollMemory={router.path}>
    <ConflictList />

    <div class="card" id="backup">
      <h2 class="section-title">Backup</h2>
      {#if nasBackup.configured}
        <p class="backup-state backup-state--{health.tone}">{health.text}</p>
        <div class="status-row">
          <span class="status-key">Last attempt</span>
          <span class="status-val"
            >{nasBackup.lastAttempt
              ? `${when(nasBackup.lastAttempt.at)} · ${nasBackup.lastAttempt.ok ? (nasBackup.lastAttempt.partial ? 'partly backed up' : 'backed up') : 'failed'}`
              : 'Never'}</span
          >
        </div>
        <div class="status-row">
          <span class="status-key">Last success</span>
          <span class="status-val">{when(nasBackup.lastSyncAt ?? nasBackup.lastDataAt)}</span>
        </div>
        <div class="status-row">
          <span class="status-key">Changes not on the NAS yet</span>
          <span class="status-val">{nasBackup.running ? '…' : (unsynced ?? '—')}</span>
        </div>
        <div class="status-row">
          <span class="status-key">Photos on the NAS</span>
          <span class="status-val"
            >{nasBackup.photosBacked}/{nasBackup.photosTotal}{nasBackup.progress
              ? ` · uploading ${nasBackup.progress.done}/${nasBackup.progress.total}`
              : ''}</span
          >
        </div>
        {#if failedList.length}
          <details class="backup-list" open>
            <summary>
              {failedList.length} photo{failedList.length > 1 ? 's' : ''} from this device not uploaded
            </summary>
            {#each failedList as f (f.id)}
              <div class="backup-item">
                <span class="backup-item-head"
                  >{photoRef(f.id)} · {tripName(f.tripId)} · {(f.bytes / 1e6).toFixed(1)} MB</span
                >
                <span class="hint">{f.error}</span>
                <span class="hint">Tried {f.attempts}×; next automatic try {nextTry(f)}.</span>
              </div>
            {/each}
          </details>
        {/if}
        {#if nasBackup.missing?.items.length}
          <details class="backup-list">
            <summary>
              {nasBackup.missing.items.length} photo{nasBackup.missing.items.length > 1 ? 's' : ''}
              listed in the NAS copy but not on the NAS
            </summary>
            <p class="hint">
              Found {when(nasBackup.missing.at)}. They're not on this device either: open systema on
              the device that took them and sync, or restore them from a backup file.
            </p>
            {#each nasBackup.missing.items as m (m.id)}
              <span class="hint">{photoRef(m.id)} · {tripName(m.tripId)}</span>
            {/each}
          </details>
        {/if}
      {:else}
        <p class="hint">
          NAS sync isn't set up on this device — download a backup file regularly, or set it up
          below.
        </p>
      {/if}
      <div class="status-row">
        <span class="status-key">Last backup file</span>
        <span class="status-val">{when(nasBackup.lastFileBackupAt)}</span>
      </div>
      <div class="cluster cluster--wrap">
        {#if nasBackup.configured}
          <button class="btn btn--primary" onclick={syncNow} disabled={busy || nasBackup.running}>
            {nasBackup.running ? 'Syncing…' : 'Sync now'}
          </button>
          {#if failedList.length}
            <button
              class="btn btn--ghost"
              onclick={retryFailed}
              disabled={busy || nasBackup.running}>Retry failed only</button
            >
          {/if}
          <button class="btn btn--ghost" onclick={testConnection} disabled={busy}
            >Test connection</button
          >
          <button class="btn btn--ghost" onclick={checkNas} disabled={busy}>Check NAS copy</button>
        {/if}
        <button class="btn btn--ghost" onclick={downloadFull} disabled={busy}>
          Download full backup (.zip)
        </button>
      </div>
      {#if nasBackup.lastTest && nasBackup.configured}
        <div class="checks" aria-label="Connection test">
          <span class="hint">Connection test, {when(nasBackup.lastTest.at)}:</span>
          {#each nasBackup.lastTest.checks as c (c.label)}
            <div class="check-line" class:check-line--bad={!c.ok}>
              <span class="check-mark" aria-hidden="true">{c.ok ? '✓' : '✗'}</span>
              <span><strong>{c.label}.</strong> {c.detail}</span>
            </div>
          {/each}
        </div>
      {/if}
      {#if status}<p class="hint hint--ok" role="status">{status}</p>{/if}
    </div>

    <div class="card">
      <h2 class="section-title">Restore from a backup file</h2>
      <p class="hint">
        Pick a backup (.zip, or a .json from an older version). It's checked first and nothing is
        written until you confirm. Restoring only adds what this device doesn't have — it never
        replaces anything here.
      </p>
      <label class="btn btn--ghost" class:btn--disabled={busy}>
        Choose backup file
        <input
          type="file"
          accept=".zip,.json,application/zip,application/json"
          hidden
          onchange={onImportFile}
          disabled={busy}
        />
      </label>
      <button class="btn btn--ghost" onclick={pasteImport} disabled={busy}>
        Paste a .json backup from the clipboard
      </button>
      <label class="switch">
        <input type="checkbox" bind:checked={fillEmpty} disabled={busy || !!pending} />
        <span class="hint">
          Also fill in blank fields on records I already have — a reconstructed journal, say.
          Anything already filled in here is left alone.
        </span>
      </label>
      {#if pending}
        <button class="btn btn--primary" onclick={confirmImport} disabled={busy}>
          Restore these records
        </button>
      {/if}
    </div>

    <div class="card">
      <h2 class="section-title">NAS sync</h2>
      <p class="hint">
        Keeps this device and your other devices in step through a NAS you host, and backs
        everything up there: a snapshot after changes, each photo once. Edits from two devices
        combine; if the same thing was changed on both, the newer edit is kept and the other is
        listed above for you to choose. Setup:
        <a
          href="https://github.com/ethan-ghoreishi/systema/blob/main/docs/nas-backup-setup.md"
          target="_blank"
          rel="noreferrer">docs/nas-backup-setup.md</a
        >.
      </p>

      <div>
        <label class="label" for="nas-url">Backup receiver URL</label>
        <input
          id="nas-url"
          class="field"
          class:field--warn={nasUrlMixed}
          type="url"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="https://your-nas.synology.me/systema-backup.php"
          bind:value={s.current.nasUrl}
        />
        {#if nasUrlMixed}
          <p class="hint hint--warn">
            This app runs over HTTPS, so it can only call an <strong>https://</strong> address with
            a valid certificate — a plain <code>http://192.168.x.x</code> URL is blocked by the
            browser (mixed content), even on home wifi. If your ISP blocks inbound (so
            <code>synology.me</code> won't load), the robust fix is Tailscale — see the setup guide.
          </p>
        {/if}
      </div>

      <div>
        <label class="label" for="nas-token">Backup token</label>
        <input
          id="nas-token"
          class="field"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="Same value as $TOKEN in the receiver"
          bind:value={s.current.nasToken}
        />
      </div>

      <div class="save-bar">
        <button class="btn btn--primary" onclick={() => s.save()} disabled={s.saving}>
          {s.saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>

    <div class="card">
      <h2 class="section-title">App &amp; storage</h2>

      <div class="status-row">
        <span class="status-key">Connection</span>
        <span class="status-val">{connectivity.online ? 'Online' : 'Offline'}</span>
      </div>
      <div class="status-row">
        <span class="status-key">Installed</span>
        <span class="status-val">{standalone ? 'Yes — running as an app' : 'Not yet'}</span>
      </div>
      <div class="status-row">
        <span class="status-key">Persistent storage</span>
        <span class="status-val">
          {persisted === null ? 'Unknown' : persisted ? 'Granted' : 'Not granted'}
        </span>
      </div>

      {#if persisted === false}
        <button class="btn btn--ghost" onclick={requestPersist}>Request persistent storage</button>
        <p class="hint">Helps stop the browser evicting your local data under storage pressure.</p>
      {/if}

      {#if canInstall}
        <button class="btn btn--ghost" onclick={install}>Install app</button>
      {:else if !standalone}
        <p class="hint">
          To install on iPhone: tap the Share icon in Safari, then “Add to Home Screen”.
        </p>
      {/if}

      <div class="status-row">
        <span class="status-key">Version</span>
        <span class="status-val">{version}</span>
      </div>
    </div>
  </div>
</div>

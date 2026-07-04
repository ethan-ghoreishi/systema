<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import { settingsStore } from '../lib/settings.svelte';
  import { connectivity } from '../lib/connectivity.svelte';
  import { nasBackup } from '../lib/nas.svelte';
  import { buildBackup, importBackup } from '../lib/export';
  import { downloadText } from '../lib/download';
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

  // ---- Data: restore / import / paste / download ----
  let dataStatus = $state('');
  let dataBusy = $state(false);

  async function restoreFromNas(): Promise<void> {
    dataBusy = true;
    dataStatus = 'Restoring from NAS…';
    const r = await nasBackup.restore();
    dataStatus = r.ok ? r.message : `Restore failed: ${r.message}`;
    dataBusy = false;
  }

  async function importData(raw: string): Promise<void> {
    dataBusy = true;
    try {
      const r = await importBackup(JSON.parse(raw));
      await settingsStore.load();
      dataStatus = `Imported ${r.trips} trip(s), ${r.stops} stop(s), ${r.expenses} expense(s), ${r.photos} photo(s).`;
    } catch (err) {
      dataStatus = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      dataBusy = false;
    }
  }

  async function onImportFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await importData(await file.text());
  }

  async function pasteImport(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        dataStatus = 'Clipboard is empty.';
        return;
      }
      await importData(text);
    } catch {
      dataStatus = 'Could not read the clipboard — use the file import instead.';
    }
  }

  async function downloadFull(): Promise<void> {
    dataBusy = true;
    dataStatus = 'Building backup…';
    try {
      const backup = await buildBackup();
      downloadText(`systema-backup-${todayIso()}.json`, JSON.stringify(backup), 'application/json');
      dataStatus = 'Backup downloaded.';
    } finally {
      dataBusy = false;
    }
  }
</script>

<div class="screen-frame">
  <TopBar title="Settings" back="#/" />

  <div class="screen-body">
    <div class="card">
      <h2 class="section-title">NAS backup vault</h2>
      <p class="hint">
        Backs everything up to your Synology automatically whenever it's reachable — a data snapshot
        after every change, and each photo once. Photos on the NAS are safe to delete from the phone
        to free space. Setup:
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
        <button
          class="btn btn--ghost"
          onclick={() => nasBackup.run().then(() => nasBackup.refreshCounts())}
          disabled={nasBackup.running || !s.current.nasUrl.trim()}
        >
          {nasBackup.running ? 'Backing up…' : 'Back up now'}
        </button>
      </div>

      <div class="status-row">
        <span class="status-key">Last data backup</span>
        <span class="status-val">
          {nasBackup.lastDataAt ? new Date(nasBackup.lastDataAt).toLocaleString('en-GB') : 'Never'}
        </span>
      </div>
      <div class="status-row">
        <span class="status-key">Photos on NAS</span>
        <span class="status-val">{nasBackup.photosBacked}/{nasBackup.photosTotal}</span>
      </div>
      {#if nasBackup.lastError}
        <p class="hint hint--warn">
          Last attempt failed ({nasBackup.lastError}) — normal when away from the NAS; it retries
          automatically.
        </p>
      {/if}
    </div>

    <div class="card">
      <h2 class="section-title">Data on this device</h2>
      <p class="hint">
        Getting everything onto a fresh install: <strong>Restore from NAS</strong> pulls the newest snapshot
        and its photos (needs the receiver above). No receiver yet? Import the backup JSON as a file (Files
        app → smb://192.168.0.20 → systema-backups) — or copy it on the Mac and paste here via Universal
        Clipboard.
      </p>

      <button
        class="btn btn--primary"
        onclick={restoreFromNas}
        disabled={dataBusy || !s.current.nasUrl.trim()}
      >
        Restore from NAS
      </button>
      <label class="btn btn--ghost" class:btn--disabled={dataBusy}>
        Import backup file (JSON)
        <input
          type="file"
          accept="application/json,.json"
          hidden
          onchange={onImportFile}
          disabled={dataBusy}
        />
      </label>
      <button class="btn btn--ghost" onclick={pasteImport} disabled={dataBusy}>
        Paste backup from clipboard
      </button>
      <button class="btn btn--ghost" onclick={downloadFull} disabled={dataBusy}>
        Download full backup (JSON)
      </button>
      {#if dataStatus}<p class="hint hint--ok">{dataStatus}</p>{/if}
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

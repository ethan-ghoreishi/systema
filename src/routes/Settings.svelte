<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import { settingsStore } from '../lib/settings.svelte';
  import { connectivity } from '../lib/connectivity.svelte';
  import { isLikelyAppsScriptUrl } from '../lib/format';
  import { nasBackup } from '../lib/nas.svelte';

  const s = settingsStore;
  const version = __APP_VERSION__;

  let persisted = $state<boolean | null>(null);
  let standalone = $state<boolean>(false);
  let canInstall = $state<boolean>(false);
  let deferredPrompt: any = null;

  const urlLooksValid = $derived(
    s.current.webAppUrl.trim() === '' || isLikelyAppsScriptUrl(s.current.webAppUrl.trim()),
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
          type="url"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="https://your-nas.synology.me/systema-backup.php"
          bind:value={s.current.nasUrl}
        />
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

    <!-- Legacy, optional: live-append to a Google capture sheet. The app is the
         ledger now; CSV export is the normal route into the master sheet. -->
    <details class="card legacy-card">
      <summary class="section-title">Google Sheet sync (optional, legacy)</summary>
      <p class="hint">
        Live-appends each expense to a dedicated capture sheet via an Apps Script web app. Not
        needed with the in-app ledger + CSV export; kept for those who want it (see
        docs/apps-script-setup.md).
      </p>

      <div>
        <label class="label" for="webapp-url">Apps Script web app URL</label>
        <input
          id="webapp-url"
          class="field"
          class:field--warn={!urlLooksValid}
          type="url"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="https://script.google.com/macros/s/…/exec"
          bind:value={s.current.webAppUrl}
        />
        {#if !urlLooksValid}
          <p class="hint hint--warn">That doesn't look like a Google Apps Script /exec URL.</p>
        {/if}
      </div>

      <div>
        <label class="label" for="shared-token">Shared token (optional)</label>
        <input
          id="shared-token"
          class="field"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="Optional shared secret"
          bind:value={s.current.sharedToken}
        />
        <p class="hint">Stored only on this device. No other secrets are kept.</p>
      </div>

      <div class="save-bar">
        <button class="btn btn--primary" onclick={() => s.save()} disabled={s.saving}>
          {s.saving ? 'Saving…' : 'Save'}
        </button>
        {#if s.savedAt}
          <span class="hint hint--ok">Saved</span>
        {/if}
      </div>
    </details>

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

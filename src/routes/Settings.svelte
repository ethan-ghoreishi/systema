<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import { settingsStore } from '../lib/settings.svelte';
  import { connectivity } from '../lib/connectivity.svelte';
  import { isLikelyAppsScriptUrl } from '../lib/format';

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
      <h2 class="section-title">Capture sync</h2>
      <p class="hint">
        Where expense rows are sent (used from Phase 2). This is the only thing the app talks to —
        it appends rows to your one capture sheet and never reads your Drive.
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

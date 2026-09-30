<script lang="ts">
  import { useRegisterSW } from 'virtual:pwa-register/svelte';
  import { router } from '../lib/router.svelte';

  /**
   * autoUpdate registration. A new build activates on its own; we then reload
   * to it, so the installed PWA is never stuck on a stale version. We also poll
   * for updates hourly and whenever the app is refocused, because iOS is lazy
   * about checking on its own.
   *
   * The reload waits until the app is on Home, which holds no unsaved input
   * (expense drafts, journal paste-back, prompt answers, NAS fields all live
   * elsewhere). The old page keeps working meanwhile: the app is one bundle,
   * already loaded. A cold start picks up the new version anyway.
   */
  const HOUR = 60 * 60 * 1000;
  let reloadPending = $state(false);

  const { offlineReady } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      setInterval(() => void reg.update(), HOUR);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update();
      });
    },
    // Without this, the plugin reloads immediately — even mid-entry.
    onNeedReload() {
      reloadPending = true;
    },
  });

  $effect(() => {
    if (!reloadPending || router.path !== '/') return;
    // Give any save fired by leaving the previous screen time to finish.
    const t = setTimeout(() => {
      if (router.path === '/' && !document.querySelector('dialog[open]')) location.reload();
    }, 1000);
    return () => clearTimeout(t);
  });

  function dismiss() {
    offlineReady.set(false);
  }
</script>

{#if $offlineReady}
  <div class="toast" role="status">
    <span class="toast-text">Ready to work offline</span>
    <button class="icon-btn icon-btn--sm" aria-label="Dismiss" onclick={dismiss}>✕</button>
  </div>
{/if}

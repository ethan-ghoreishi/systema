<script lang="ts">
  import { useRegisterSW } from 'virtual:pwa-register/svelte';

  /**
   * autoUpdate registration. When a new build is found the service worker takes
   * over and we reload to it, so the installed PWA is never stuck on a stale
   * version. We also poll for updates hourly and whenever the app is refocused,
   * because iOS is lazy about checking on its own.
   *
   * To avoid yanking the screen mid-entry, the reload waits until no capture
   * modal is open and the app is visible.
   */
  const HOUR = 60 * 60 * 1000;

  const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      setInterval(() => void reg.update(), HOUR);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update();
      });
    },
  });

  // When an update is ready, apply it as soon as it's safe.
  $effect(() => {
    if (!$needRefresh) return;
    const tryApply = () => {
      if (document.visibilityState === 'visible' && !document.querySelector('.modal')) {
        void updateServiceWorker(true); // activates the new SW and reloads
      }
    };
    tryApply();
    const t = setInterval(tryApply, 3000);
    return () => clearInterval(t);
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

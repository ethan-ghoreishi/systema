/**
 * Per-screen view state that should survive leaving and coming back — the
 * scroll position of a list, Map vs List, the city filter — for this session
 * (and across an app update's reload). Device-local: never synced or backed
 * up. Storage failures (private mode) degrade to in-memory.
 */

const KEY = 'systema:ui';
let store: Record<string, unknown> = {};
try {
  store = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') ?? {};
} catch {
  store = {};
}

let pending = 0;
function persist(): void {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      // In-memory only.
    }
  });
}

export function recall<T>(key: string, fallback: T): T {
  return key in store ? (store[key] as T) : fallback;
}

export function remember(key: string, value: unknown): void {
  store[key] = value;
  persist();
}

/**
 * Keep a scroll container's position per `key` (the route) and put it back
 * when the key returns — waiting for content that loads asynchronously (the
 * list comes from IndexedDB), and giving up as soon as the user scrolls.
 */
export function scrollMemory(node: HTMLElement, key: string) {
  let current = key;
  let frame = 0;
  let stopRestore: (() => void) | null = null;

  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      remember(`scroll:${current}`, node.scrollTop);
    });
  };

  function restore(): void {
    stopRestore?.();
    const target = recall(`scroll:${current}`, 0);
    node.scrollTop = target;
    if (Math.abs(node.scrollTop - target) < 2) return;
    let done = false;
    const attempt = () => {
      if (done) return;
      node.scrollTop = target;
      if (Math.abs(node.scrollTop - target) < 2) stop();
    };
    const observer = new MutationObserver(attempt);
    observer.observe(node, { childList: true, subtree: true });
    const timer = setTimeout(stop, 2500);
    const events = ['touchstart', 'wheel', 'keydown', 'pointerdown'] as const;
    function stop(): void {
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      for (const ev of events) node.removeEventListener(ev, stop);
      if (stopRestore === stop) stopRestore = null;
    }
    for (const ev of events) node.addEventListener(ev, stop, { passive: true });
    stopRestore = stop;
  }

  node.addEventListener('scroll', onScroll, { passive: true });
  restore();
  return {
    update(next: string) {
      if (next === current) return;
      current = next;
      restore();
    },
    destroy() {
      node.removeEventListener('scroll', onScroll);
      stopRestore?.();
      cancelAnimationFrame(frame);
    },
  };
}

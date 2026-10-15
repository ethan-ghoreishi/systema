/**
 * Minimal hash router built on a Svelte 5 rune, with in-app history.
 *
 * Hash routing is deliberate: it needs no server rewrites, so it works on
 * GitHub Pages and fully offline from the installed app. `router.path` is
 * reactive — read it in any component and it updates on navigation.
 *
 * Every entry the app pushes is numbered (history.state.sysIdx) and mirrored
 * in a small stack, so Back can return to where you actually came from — the
 * Stops list you opened a stop from, the Insights page you opened a trip
 * from — and fall back to the screen's natural parent after a cold start or
 * a deep link. Same-level moves (trip tabs) replace instead of piling up.
 * Plain `<a href="#/…">` links are routed through here automatically; add
 * `data-replace` for a same-level move.
 */

const STACK_KEY = 'systema:nav';

function parseHash(): string {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function loadStack(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(STACK_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

class Router {
  path = $state<string>('/');
  private index = 0;
  private stack: string[] = [];

  constructor() {
    if (typeof window === 'undefined') return;
    this.path = parseHash();
    const idx = (history.state as { sysIdx?: unknown } | null)?.sysIdx;
    const stack = loadStack();
    if (typeof idx === 'number' && stack[idx] === this.path) {
      this.index = idx;
      this.stack = stack;
    } else {
      this.stack = [this.path];
      this.mark(0);
    }
    this.save();
    window.addEventListener('popstate', () => this.syncFromLocation());
    window.addEventListener('hashchange', () => this.syncFromLocation());
    document.addEventListener('click', (e) => this.onClick(e));
  }

  private mark(index: number, url?: string): void {
    this.index = index;
    history.replaceState({ ...(history.state ?? {}), sysIdx: index }, '', url);
  }

  private save(): void {
    try {
      sessionStorage.setItem(STACK_KEY, JSON.stringify(this.stack));
    } catch {
      // Private mode or storage blocked: in-memory history still works.
    }
  }

  /** Back/forward, or a hash changed outside the router (typed, external link). */
  private syncFromLocation(): void {
    const path = parseHash();
    const idx = (history.state as { sysIdx?: unknown } | null)?.sysIdx;
    if (typeof idx === 'number') {
      this.index = idx;
      this.stack[idx] = path;
    } else if (path !== this.path) {
      this.stack = [...this.stack.slice(0, this.index + 1), path];
      this.mark(this.index + 1);
    }
    this.path = path;
    this.save();
  }

  private onClick(e: MouseEvent): void {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const a = (e.target as Element | null)?.closest?.('a[href^="#/"]') as HTMLAnchorElement | null;
    if (!a || a.target) return;
    e.preventDefault();
    this.go(a.getAttribute('href')!.slice(1), { replace: a.hasAttribute('data-replace') });
  }

  go(path: string, { replace = false } = {}): void {
    const target = path.startsWith('/') ? path : `/${path}`;
    if (target === this.path) return;
    if (replace) {
      this.stack[this.index] = target;
      history.replaceState({ ...(history.state ?? {}), sysIdx: this.index }, '', `#${target}`);
    } else {
      this.index += 1;
      this.stack = [...this.stack.slice(0, this.index), target];
      history.pushState({ sysIdx: this.index }, '', `#${target}`);
    }
    this.path = target;
    this.save();
  }

  /**
   * Go back to the nearest earlier screen that `accept`s (default: the
   * previous one); with none — a cold start or deep link — replace this
   * screen with `fallback`, its natural parent.
   */
  back(fallback: string, accept: (path: string) => boolean = () => true): void {
    for (let i = this.index - 1; i >= 0; i -= 1) {
      if (accept(this.stack[i])) {
        history.go(i - this.index);
        return;
      }
    }
    this.go(fallback, { replace: true });
  }
}

export const router = new Router();

/** Imperative navigation helper (anchors with `href="#/path"` also work). */
export function navigate(path: string, opts?: { replace?: boolean }): void {
  router.go(path, opts);
}

/** Inside trip `id` (any tab, stop, edit or prompt screen). */
export const inTrip = (id: string) => (p: string) => p.startsWith(`/trip/${id}/`);
/** Anywhere but trip `id`: where its header Back returns to. */
export const outsideTrip = (id: string) => (p: string) => !inTrip(id)(p);

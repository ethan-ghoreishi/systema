/**
 * Minimal hash router built on a Svelte 5 rune.
 *
 * Hash routing is deliberate: it needs no server rewrites, so it works on
 * GitHub Pages and fully offline from the installed app. `router.path` is
 * reactive — read it in any component and it updates on navigation.
 */

function parseHash(): string {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

class Router {
  path = $state<string>('/');

  constructor() {
    if (typeof window !== 'undefined') {
      this.path = parseHash();
      window.addEventListener('hashchange', () => {
        this.path = parseHash();
      });
    }
  }

  go(path: string): void {
    const target = path.startsWith('/') ? path : `/${path}`;
    if (location.hash !== `#${target}`) {
      location.hash = target;
    }
  }
}

export const router = new Router();

/** Imperative navigation helper (anchors with `href="#/path"` also work). */
export function navigate(path: string): void {
  router.go(path);
}

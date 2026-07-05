/**
 * Pure SVG cover generators — offline, no tiles, no network, theme-aware (they
 * use the app's CSS custom properties so they follow light/dark automatically).
 * Two kinds: a route *sketch* plotted from stop coordinates, and an abstract
 * route *ribbon* used when a trip has no mapped stops and no photo. No user text
 * goes into the markup, so it's safe to inject with {@html}.
 */

export interface CoverPoint {
  lat: number;
  lng: number;
  visited?: boolean;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function grid(): string {
  const lines: string[] = [];
  for (let i = 1; i < 4; i++) {
    const p = (i * 100) / 4;
    lines.push(
      `<line x1="${p}" y1="0" x2="${p}" y2="100" stroke="var(--hairline)" stroke-width="0.6"/>`,
      `<line x1="0" y1="${p}" x2="100" y2="${p}" stroke="var(--hairline)" stroke-width="0.6"/>`,
    );
  }
  return lines.join('');
}

/** A route plotted from stop coordinates: connecting line + numbered-ish dots. */
export function routeSketchSvg(points: CoverPoint[]): string {
  if (points.length === 0) return routeRibbonSvg('empty');
  const pad = 18;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const cx = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const cy = (Math.min(...lats) + Math.max(...lats)) / 2;
  const span =
    Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs)) || 1;
  const sx = (lng: number) => pad + ((lng - cx) / span + 0.5) * (100 - 2 * pad);
  const sy = (lat: number) => 100 - (pad + ((lat - cy) / span + 0.5) * (100 - 2 * pad));
  const pts = points.map((p) => ({ x: sx(p.lng), y: sy(p.lat), visited: p.visited !== false }));

  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const line =
    pts.length > 1
      ? `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 4" opacity="0.75"/>`
      : '';
  const dots = pts
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--accent)" opacity="${p.visited ? 1 : 0.4}"/>`,
    )
    .join('');

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Route sketch"><rect width="100" height="100" fill="var(--surface-sunken)"/>${grid()}${line}${dots}</svg>`;
}

/** An abstract route ribbon, deterministically varied per trip via `seed`. */
export function routeRibbonSvg(seed: string): string {
  const h = hash(seed);
  const deg = (h % 40) - 20; // subtle per-trip hue shift off the accent
  const y1 = 32 + (h % 18);
  const y2 = 68 - ((h >> 5) % 18);
  const gid = `cg${h.toString(36)}`;
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Route" style="filter:hue-rotate(${deg}deg)"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent-soft)"/><stop offset="1" stop-color="var(--surface-sunken)"/></linearGradient></defs><rect width="100" height="100" fill="url(#${gid})"/><path d="M8 ${y1} C 34 ${y1 - 16}, 66 ${y2 + 16}, 92 ${y2}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 5" opacity="0.7"/><circle cx="8" cy="${y1}" r="4" fill="var(--accent)"/><circle cx="92" cy="${y2}" r="4" fill="var(--accent)"/></svg>`;
}

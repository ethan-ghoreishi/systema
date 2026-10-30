<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import type { City, Moment, Stop } from '../lib/db';
  import { placeStop } from '../lib/stops';
  import { placeMoment } from '../lib/moments';
  import { activeLegId } from '../lib/trip-shape';
  import { recall, remember } from '../lib/ui-memory';

  /**
   * The route map, one city at a time. Free OpenStreetMap tiles (no key);
   * numbered markers in walking order, joined by a walking line — within a
   * city only. A multi-city trip picks the city (defaulting to the one you're
   * in); "Transfers" shows the cities themselves, joined by straight dashed
   * lines that are clearly not routes. Markers drag to fine-tune, and a
   * marker's own popup takes it off the map again; stops without coordinates
   * queue below — tap one, then tap the map to place it. A moment that is part
   * of a planned stop shows at that stop's pin; one that is its own place gets
   * a pin of its own, off the walking line.
   * In the journal (readonly) the map stays still until you tap to explore,
   * so it never traps the page's scroll.
   */
  let {
    stops,
    moments = [],
    cities = [],
    onOpen,
    readonly = false,
    memoryKey,
  }: {
    stops: Stop[];
    moments?: Moment[];
    cities?: City[];
    onOpen?: (stop: Stop) => void;
    readonly?: boolean;
    /** Remembers the chosen city per trip and screen. */
    memoryKey?: string;
  } = $props();

  const OTHER = 'other';
  const TRANSFERS = 'transfers';

  let mapEl: HTMLDivElement;
  let map: L.Map | null = null;
  let layer: L.LayerGroup | null = null;
  let placing = $state<{ kind: 'stop' | 'moment'; id: string; name: string } | null>(null);
  let exploring = $state(untrack(() => !readonly));
  let fittedFor = '';

  /** Moments that are places of their own — one part of a stop shows at its pin. */
  const ownPlace = $derived(
    moments.filter((m) => !m.stopId || !stops.some((s) => s.id === m.stopId)),
  );

  // The legs that have something to show, in leg order, plus the unassigned.
  const groups = $derived.by(() => {
    const known = new Set(cities.map((c) => c.id));
    const here = [...stops, ...ownPlace] as { cityId: string | null }[];
    const out = [...cities]
      .sort((a, b) => a.order - b.order)
      .filter((c) => here.some((r) => r.cityId === c.id))
      .map((c) => ({ key: c.id, label: c.name }));
    if (here.some((r) => !r.cityId || !known.has(r.cityId)))
      out.push({ key: OTHER, label: 'Unassigned' });
    return out;
  });
  const multi = $derived(groups.length > 1);

  function defaultChoice(): string {
    const remembered = memoryKey ? recall<string | null>(memoryKey, null) : null;
    if (remembered && (remembered === TRANSFERS || groups.some((g) => g.key === remembered)))
      return remembered;
    const here = activeLegId(cities);
    return groups.find((g) => g.key === here)?.key ?? groups[0]?.key ?? OTHER;
  }
  let chosen = $state<string | null>(null);
  const selected = $derived(
    !multi
      ? null
      : chosen && (chosen === TRANSFERS || groups.some((g) => g.key === chosen))
        ? chosen
        : defaultChoice(),
  );
  function choose(key: string) {
    chosen = key;
    if (memoryKey) remember(memoryKey, key);
  }

  const inCity = (r: { cityId: string | null }, key: string | null) => {
    if (key === null) return true;
    if (key === OTHER) return !r.cityId || !cities.some((c) => c.id === r.cityId);
    return r.cityId === key;
  };
  /** The stops on screen, in walking order, numbered within their city. */
  const shown = $derived(selected === TRANSFERS ? [] : stops.filter((s) => inCity(s, selected)));
  const shownMoments = $derived(
    selected === TRANSFERS ? [] : ownPlace.filter((m) => inCity(m, selected)),
  );
  /** Moments that are part of a planned stop: they show at that stop's pin. */
  const momentsAt = (stopId: string) =>
    moments.filter((m) => m.stopId === stopId && !ownPlace.includes(m));
  const unplaced = $derived([
    ...shown
      .filter((s) => s.lat == null || s.lng == null)
      .map((s) => ({ kind: 'stop' as const, id: s.id, name: s.name, stop: s })),
    ...shownMoments
      .filter((m) => m.lat == null || m.lng == null)
      .map((m) => ({ kind: 'moment' as const, id: m.id, name: m.title, stop: undefined })),
  ]);

  function markerIcon(label: string, visited: boolean, kind = 'map-pin'): L.DivIcon {
    return L.divIcon({
      className: '',
      html: `<div class="${kind}${visited ? ' map-pin--visited' : ''}">${escapeHtml(label)}</div>`,
      iconSize: kind.startsWith('map-pin') ? [30, 30] : undefined,
      iconAnchor: kind.startsWith('map-pin') ? [15, 15] : undefined,
      popupAnchor: [0, -14],
    });
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function round6(n: number): number {
    return Math.round(n * 1e6) / 1e6;
  }

  /** A city's point for the transfer overview: its stops' middle, else its base. */
  function cityPoint(c: City): L.LatLngExpression | null {
    const pts = stops.filter((s) => s.cityId === c.id && s.lat != null && s.lng != null);
    if (pts.length)
      return [
        pts.reduce((a, s) => a + s.lat!, 0) / pts.length,
        pts.reduce((a, s) => a + s.lng!, 0) / pts.length,
      ];
    return c.base?.lat != null && c.base?.lng != null ? [c.base.lat, c.base.lng] : null;
  }

  /** A marker's popup: what it is, and the ways to act on it. */
  function popup(
    title: string,
    body: string[],
    onRemove: () => void,
    link?: { href: string; label: string },
  ): HTMLElement {
    const el = document.createElement('div');
    const h = document.createElement('strong');
    h.textContent = title;
    el.append(h);
    for (const line of body) {
      const p = document.createElement('div');
      p.className = 'hint';
      p.textContent = line;
      el.append(p);
    }
    if (link) {
      const a = document.createElement('a');
      a.href = link.href;
      a.textContent = link.label;
      el.append(document.createElement('br'), a);
    }
    if (!readonly) {
      const b = document.createElement('button');
      b.className = 'link-btn map-remove';
      b.textContent = 'Remove from map';
      b.onclick = () => {
        map?.closePopup();
        onRemove();
      };
      el.append(document.createElement('br'), b);
    }
    return el;
  }

  function redraw() {
    if (!map || !layer) return;
    layer.clearLayers();
    const points: L.LatLngExpression[] = [];

    if (selected === TRANSFERS) {
      for (const c of [...cities].sort((a, b) => a.order - b.order)) {
        const p = cityPoint(c);
        if (!p) continue;
        points.push(p);
        layer.addLayer(L.marker(p, { icon: markerIcon(c.name, false, 'map-city'), title: c.name }));
      }
      if (points.length > 1)
        layer.addLayer(
          L.polyline(points, { className: 'map-transfer', weight: 2, dashArray: '2 8' }),
        );
    } else {
      shown.forEach((s, i) => {
        if (s.lat == null || s.lng == null) return;
        const pos: L.LatLngExpression = [s.lat, s.lng];
        points.push(pos);
        const m = L.marker(pos, {
          icon: markerIcon(String(i + 1), s.visited),
          draggable: !readonly,
          title: s.name,
        });
        m.bindPopup(
          popup(
            `${i + 1}. ${s.name}`,
            momentsAt(s.id).map((mo) => `Moment: ${mo.title}`),
            () => void placeStop(s.id, null),
            readonly ? undefined : { href: `#/trip/${s.tripId}/stops/${s.id}`, label: 'Open stop' },
          ),
        );
        if (!readonly) {
          m.on('dragend', () => {
            const p = m.getLatLng();
            void placeStop(s.id, { lat: round6(p.lat), lng: round6(p.lng) });
          });
        }
        layer!.addLayer(m);
      });
      // A walking line only within one city, and only through planned stops.
      if (points.length > 1)
        layer.addLayer(L.polyline(points, { className: 'map-route', weight: 3, dashArray: '6 8' }));

      // Moments of their own: off the line, and never numbered with the stops.
      for (const mo of shownMoments) {
        if (mo.lat == null || mo.lng == null) continue;
        const pos: L.LatLngExpression = [mo.lat, mo.lng];
        points.push(pos);
        const marker = L.marker(pos, {
          icon: markerIcon('', false, 'map-pin map-pin--moment'),
          draggable: !readonly,
          title: mo.title,
        });
        marker.bindPopup(popup(mo.title, ['Off the plan'], () => void placeMoment(mo.id, null)));
        if (!readonly)
          marker.on('dragend', () => {
            const p = marker.getLatLng();
            void placeMoment(mo.id, { lat: round6(p.lat), lng: round6(p.lng) });
          });
        layer!.addLayer(marker);
      }
    }

    // Refit when the city (or view) changes — not when a stop is dragged.
    const fitKey = `${selected}:${points.length > 0}`;
    if (fittedFor !== fitKey && points.length > 0) {
      fittedFor = fitKey;
      if (points.length === 1) map.setView(points[0], selected === TRANSFERS ? 9 : 15);
      else map.fitBounds(L.latLngBounds(points), { padding: [36, 36] });
    }
  }

  function onMapClick(e: L.LeafletMouseEvent) {
    if (!placing) return;
    const { kind, id } = placing;
    placing = null;
    const pos = { lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) };
    void (kind === 'stop' ? placeStop(id, pos) : placeMoment(id, pos));
  }

  function setInteractive(on: boolean) {
    if (!map) return;
    for (const h of [map.dragging, map.touchZoom, map.doubleClickZoom, map.scrollWheelZoom])
      if (on) h.enable();
      else h.disable();
  }

  onMount(() => {
    map = L.map(mapEl, {
      zoomControl: true,
      attributionControl: true,
      // Journal maps sit in a scrolling page: still until you choose to explore.
      dragging: exploring,
      touchZoom: exploring,
      doubleClickZoom: exploring,
      scrollWheelZoom: exploring,
      boxZoom: false,
      keyboard: !readonly,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    if (!readonly) map.on('click', onMapClick);
    // Sensible default before any stop is placed.
    map.setView([51.5074, -0.1278], 11);
    redraw();
  });

  onDestroy(() => {
    map?.remove();
    map = null;
  });

  // Redraw whenever what is shown, or the chosen city, changes.
  $effect(() => {
    void shown;
    void shownMoments;
    void selected;
    void stops;
    void moments;
    redraw();
  });

  $effect(() => setInteractive(exploring));
</script>

<div class="map-wrap">
  {#if multi}
    <div class="chips map-cities" role="tablist" aria-label="City on the map">
      {#each groups as g (g.key)}
        <button
          class="chip chip--sm"
          class:chip--on={selected === g.key}
          role="tab"
          aria-selected={selected === g.key}
          onclick={() => choose(g.key)}>{g.label}</button
        >
      {/each}
      <button
        class="chip chip--sm"
        class:chip--on={selected === TRANSFERS}
        role="tab"
        aria-selected={selected === TRANSFERS}
        onclick={() => choose(TRANSFERS)}>Transfers</button
      >
    </div>
  {/if}

  <div class="map-box">
    <div class="map-canvas" bind:this={mapEl}></div>
    {#if !exploring}
      <button class="map-explore" onclick={() => (exploring = true)}>Tap to explore the map</button>
    {/if}
  </div>
  {#if selected === TRANSFERS}
    <p class="hint">
      The order of travel between cities. Straight lines show the sequence, not a route.
    </p>
  {/if}

  {#if !readonly && selected !== TRANSFERS}
    {#if placing}
      <p class="hint hint--ok map-placing">
        Tap the map to place “{placing.name}” — or
        <button class="link-btn" onclick={() => (placing = null)}>cancel</button>
      </p>
    {/if}

    {#if unplaced.length}
      <div class="map-unplaced">
        <span class="section-title">Not on the map yet</span>
        {#each unplaced as u (u.id)}
          <div class="map-unplaced-row">
            {#if u.stop}
              <button class="stop-open" onclick={() => onOpen?.(u.stop)}>
                <span class="stop-name">{u.name}</span>
              </button>
            {:else}
              <span class="stop-open"><span class="stop-name">{u.name}</span></span>
            {/if}
            <button
              class="btn btn--ghost btn--sm"
              onclick={() => (placing = { kind: u.kind, id: u.id, name: u.name })}
            >
              Place on map
            </button>
          </div>
        {/each}
      </div>
    {/if}

    {#if stops.length === 0 && ownPlace.length === 0}
      <p class="hint">
        No stops yet — add them on the List view or extract them from the plan first.
      </p>
    {/if}
  {/if}
</div>

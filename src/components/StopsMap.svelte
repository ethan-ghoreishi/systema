<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import type { City, Stop } from '../lib/db';
  import { updateStop } from '../lib/stops';
  import { activeLegId } from '../lib/trip-shape';
  import { recall, remember } from '../lib/ui-memory';

  /**
   * The route map, one city at a time. Free OpenStreetMap tiles (no key);
   * numbered markers in walking order, joined by a walking line — within a
   * city only. A multi-city trip picks the city (defaulting to the one you're
   * in); "Transfers" shows the cities themselves, joined by straight dashed
   * lines that are clearly not routes. Markers drag to fine-tune; stops
   * without coordinates queue below — tap one, then tap the map to place it.
   * In the journal (readonly) the map stays still until you tap to explore,
   * so it never traps the page's scroll.
   */
  let {
    stops,
    cities = [],
    onOpen,
    readonly = false,
    memoryKey,
  }: {
    stops: Stop[];
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
  let placingId = $state<string | null>(null);
  let exploring = $state(!readonly);
  let fittedFor = '';

  // The cities that have stops, in leg order, plus "Other" for unassigned ones.
  const groups = $derived.by(() => {
    const known = new Set(cities.map((c) => c.id));
    const out = [...cities]
      .sort((a, b) => a.order - b.order)
      .filter((c) => stops.some((s) => s.cityId === c.id))
      .map((c) => ({ key: c.id, label: c.name }));
    if (stops.some((s) => !s.cityId || !known.has(s.cityId)))
      out.push({ key: OTHER, label: 'Other' });
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

  const inCity = (s: Stop, key: string | null) => {
    if (key === null) return true;
    if (key === OTHER) return !s.cityId || !cities.some((c) => c.id === s.cityId);
    return s.cityId === key;
  };
  /** The stops on screen, in walking order, numbered within their city. */
  const shown = $derived(selected === TRANSFERS ? [] : stops.filter((s) => inCity(s, selected)));
  const unplaced = $derived(shown.filter((s) => s.lat == null || s.lng == null));

  function markerIcon(label: string, visited: boolean, kind = 'map-pin'): L.DivIcon {
    return L.divIcon({
      className: '',
      html: `<div class="${kind}${visited ? ' map-pin--visited' : ''}">${escapeHtml(label)}</div>`,
      iconSize: kind === 'map-pin' ? [30, 30] : undefined,
      iconAnchor: kind === 'map-pin' ? [15, 15] : undefined,
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
        const link = readonly
          ? ''
          : `<br/><a href="#/trip/${s.tripId}/stops/${s.id}">Open stop</a>`;
        m.bindPopup(`<strong>${i + 1}. ${escapeHtml(s.name)}</strong>${link}`);
        if (!readonly) {
          m.on('dragend', () => {
            const p = m.getLatLng();
            void updateStop(s.id, { lat: round6(p.lat), lng: round6(p.lng) });
          });
        }
        layer!.addLayer(m);
      });
      // A walking line only within one city.
      if (points.length > 1)
        layer.addLayer(L.polyline(points, { className: 'map-route', weight: 3, dashArray: '6 8' }));
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
    if (!placingId) return;
    const id = placingId;
    placingId = null;
    void updateStop(id, { lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) });
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

  // Redraw whenever stops or the chosen city change.
  $effect(() => {
    void shown;
    void selected;
    void stops;
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
    {#if placingId}
      {@const placing = stops.find((s) => s.id === placingId)}
      <p class="hint hint--ok map-placing">
        Tap the map to place “{placing?.name}” — or
        <button class="link-btn" onclick={() => (placingId = null)}>cancel</button>
      </p>
    {/if}

    {#if unplaced.length}
      <div class="map-unplaced">
        <span class="section-title">Not on the map yet</span>
        {#each unplaced as s (s.id)}
          <div class="map-unplaced-row">
            <button class="stop-open" onclick={() => onOpen?.(s)}>
              <span class="stop-name">{s.name}</span>
            </button>
            <button class="btn btn--ghost btn--sm" onclick={() => (placingId = s.id)}>
              Place on map
            </button>
          </div>
        {/each}
      </div>
    {/if}

    {#if stops.length === 0}
      <p class="hint">
        No stops yet — add them on the List view or extract them from the plan first.
      </p>
    {/if}
  {/if}
</div>

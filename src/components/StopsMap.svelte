<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import type { Stop } from '../lib/db';
  import { updateStop } from '../lib/stops';

  /**
   * The trip route map. Free OpenStreetMap tiles (no key); numbered markers in
   * walking order joined by a route line; visited stops fill in. Markers drag
   * to fine-tune. Stops without coordinates queue below — tap one, then tap
   * the map to place it. Everything redraws live as stops change.
   */
  let {
    stops,
    onOpen,
    readonly = false,
  }: {
    stops: Stop[];
    onOpen?: (stop: Stop) => void;
    readonly?: boolean;
  } = $props();

  let mapEl: HTMLDivElement;
  let map: L.Map | null = null;
  let layer: L.LayerGroup | null = null;
  let placingId = $state<string | null>(null);
  let didInitialFit = false;

  const placed = $derived(stops.filter((s) => s.lat != null && s.lng != null));
  const unplaced = $derived(stops.filter((s) => s.lat == null || s.lng == null));

  function markerIcon(n: number, visited: boolean): L.DivIcon {
    return L.divIcon({
      className: '',
      html: `<div class="map-pin${visited ? ' map-pin--visited' : ''}">${n}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -14],
    });
  }

  function redraw() {
    if (!map || !layer) return;
    layer.clearLayers();

    const line: L.LatLngExpression[] = [];
    stops.forEach((s, i) => {
      if (s.lat == null || s.lng == null) return;
      const pos: L.LatLngExpression = [s.lat, s.lng];
      line.push(pos);
      const m = L.marker(pos, {
        icon: markerIcon(i + 1, s.visited),
        draggable: !readonly,
        title: s.name,
      });
      const link = readonly ? '' : `<br/><a href="#/trip/${s.tripId}/stops/${s.id}">Open stop</a>`;
      m.bindPopup(`<strong>${i + 1}. ${escapeHtml(s.name)}</strong>${link}`);
      if (!readonly) {
        m.on('dragend', () => {
          const p = m.getLatLng();
          void updateStop(s.id, { lat: round6(p.lat), lng: round6(p.lng) });
        });
      }
      layer!.addLayer(m);
    });

    if (line.length > 1) {
      layer.addLayer(
        L.polyline(line, { color: 'var(--accent)', weight: 3, opacity: 0.7, dashArray: '6 8' }),
      );
    }

    if (!didInitialFit && line.length > 0) {
      didInitialFit = true;
      if (line.length === 1) map.setView(line[0], 15);
      else map.fitBounds(L.latLngBounds(line), { padding: [36, 36] });
    }
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function round6(n: number): number {
    return Math.round(n * 1e6) / 1e6;
  }

  function onMapClick(e: L.LeafletMouseEvent) {
    if (!placingId) return;
    const id = placingId;
    placingId = null;
    void updateStop(id, { lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) });
  }

  onMount(() => {
    map = L.map(mapEl, {
      zoomControl: !readonly,
      attributionControl: true,
      // In a journal the map sits in a scrolling page; don't trap the page
      // scroll with the wheel, and don't let it grab focus.
      scrollWheelZoom: !readonly,
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

  // Redraw whenever stops change (order, visited, coordinates, additions).
  $effect(() => {
    void stops;
    redraw();
  });
</script>

<div class="map-wrap">
  <div class="map-canvas" bind:this={mapEl}></div>

  {#if !readonly}
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

    {#if placed.length === 0 && unplaced.length === 0}
      <p class="hint">
        No stops yet — add them on the List view or extract them from the plan first.
      </p>
    {/if}
  {/if}
</div>

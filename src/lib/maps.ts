import type { City, Stop } from './db';

export function hasPin(place: { lat?: number; lng?: number }): boolean {
  return (
    Number.isFinite(place.lat) &&
    Math.abs(place.lat!) <= 90 &&
    Number.isFinite(place.lng) &&
    Math.abs(place.lng!) <= 180
  );
}

/** No routing, geocoding, location permission or API key. Google Maps owns
 * the journey. An unpinned stop is a named search, never a guessed destination.
 */
export function mapsLink(
  stop: Stop,
  cities: City[],
  search = false,
): { href: string; label: string } {
  const pinned = hasPin(stop) && !search;
  const city =
    cities.find((c) => c.id === stop.cityId)?.name ??
    stop.legName ??
    (cities.length === 1 ? cities[0].name : '');
  const params = new URLSearchParams({ api: '1' });
  if (pinned) params.set('destination', `${stop.lat},${stop.lng}`);
  else params.set('query', [stop.name, city].filter(Boolean).join(', '));
  return {
    href: `https://www.google.com/maps/${pinned ? 'dir' : 'search'}/?${params}`,
    label: pinned ? 'Directions in Google Maps' : 'Find in Google Maps',
  };
}

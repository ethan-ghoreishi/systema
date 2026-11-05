import { describe, expect, it } from 'vitest';
import type { City, Stop } from '../../src/lib/db';
import { hasPin, mapsLink } from '../../src/lib/maps';

const stop = { name: 'Duomo & museum', cityId: 'c' } as Stop;
const cities = [
  { id: 'c', name: 'Florence' },
  { id: 'b', name: 'Milan' },
] as City[];

describe('Google Maps handoff', () => {
  it('uses coordinates including zero, with no guessed origin or mode', () => {
    const link = mapsLink({ ...stop, lat: 0, lng: 0 }, cities);
    const url = new URL(link.href);
    expect(url.pathname).toBe('/maps/dir/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ api: '1', destination: '0,0' });
  });
  it('searches by name and the correct city when a pin is missing or invalid', () => {
    for (const pin of [{}, { lat: 44 }, { lat: NaN, lng: 1 }, { lat: 91, lng: 181 }]) {
      const link = mapsLink({ ...stop, ...pin }, cities);
      const url = new URL(link.href);
      expect(link.label).toBe('Find in Google Maps');
      expect(url.searchParams.get('query')).toBe('Duomo & museum, Florence');
    }
  });
  it('never guesses one of several cities for an unassigned stop; keeps a deleted leg name', () => {
    expect(
      new URL(mapsLink({ ...stop, cityId: null }, cities).href).searchParams.get('query'),
    ).toBe('Duomo & museum');
    expect(
      new URL(mapsLink({ ...stop, cityId: null, legName: 'Rome' }, cities).href).searchParams.get(
        'query',
      ),
    ).toBe('Duomo & museum, Rome');
    expect(hasPin({ lat: 90, lng: -180 })).toBe(true);
  });
});

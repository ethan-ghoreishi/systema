import type { Backup } from './export';

/** Reject malformed data before any write. Optional legacy fields stay optional. */
export function validateBackup(value: unknown): asserts value is Backup {
  // Name the offending row, so a failed restore can be diagnosed and repaired.
  const fail = (where: string) => {
    throw new Error(`Invalid or unsupported systema backup (${where}). No data imported.`);
  };
  const object = (v: unknown): v is Record<string, any> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const strings = (r: Record<string, any>, keys: string) =>
    keys.split(' ').every((k) => typeof r[k] === 'string');
  const numbers = (r: Record<string, any>, keys: string) =>
    keys.split(' ').every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
  const optional = (r: Record<string, any>, keys: string, type: string) =>
    keys.split(' ').every((k) => r[k] === undefined || typeof r[k] === type);
  if (!object(value) || value.app !== 'systema' || value.version !== 1)
    fail('not a version 1 systema backup');
  const data = value as Record<string, any>;
  const rows = (key: string, idKey: string, check: (r: Record<string, any>) => boolean) => {
    const list = data[key];
    if (!Array.isArray(list)) return fail(`${key} missing`);
    const ids = new Set<string>();
    for (const [i, row] of list.entries()) {
      if (
        !object(row) ||
        typeof row[idKey] !== 'string' ||
        !row[idKey].trim() ||
        ids.has(row[idKey]) ||
        !check(row)
      )
        fail(`${key} row ${i + 1}${typeof row?.[idKey] === 'string' ? `, ${row[idKey]}` : ''}`);
      ids.add(row[idKey]);
    }
  };
  rows(
    'trips',
    'id',
    (r) =>
      strings(r, 'name type startDate endDate returnFlightAt status planText') &&
      numbers(r, 'partySize order createdAt updatedAt') &&
      r.partySize > 0 &&
      typeof r.accommodation === 'boolean' &&
      ['same-day', 'airport-sleep', 'weekend', 'custom'].includes(r.type) &&
      ['planning', 'active', 'done'].includes(r.status) &&
      optional(r, 'nameManual journalText coverPhotoId', 'string') &&
      (r.coverMode === undefined || ['auto', 'map', 'route-card', 'photo'].includes(r.coverMode)) &&
      (r.promptPrefs === undefined ||
        (object(r.promptPrefs) &&
          optional(
            r.promptPrefs,
            'mode pace budget companions hotel constraints pastVisits notes',
            'string',
          ) &&
          (r.promptPrefs.interests === undefined ||
            (Array.isArray(r.promptPrefs.interests) &&
              r.promptPrefs.interests.every((v: unknown) => typeof v === 'string'))))),
  );
  rows(
    'cities',
    'id',
    (r) =>
      strings(r, 'tripId name currency') &&
      numbers(r, 'order') &&
      optional(r, 'arrival departure', 'string') &&
      (r.sleep === undefined || ['none', 'airport', 'hotel'].includes(r.sleep)),
  );
  rows(
    'stops',
    'id',
    (r) =>
      strings(r, 'tripId name notes') &&
      numbers(r, 'order createdAt') &&
      (r.cityId === null || typeof r.cityId === 'string') &&
      typeof r.visited === 'boolean' &&
      (r.lat === undefined ||
        (typeof r.lat === 'number' && Number.isFinite(r.lat) && Math.abs(r.lat) <= 90)) &&
      (r.lng === undefined ||
        (typeof r.lng === 'number' && Number.isFinite(r.lng) && Math.abs(r.lng) <= 180)) &&
      Array.isArray(r.checklist) &&
      r.checklist.every(
        (c: unknown) => object(c) && strings(c, 'id text') && typeof c.done === 'boolean',
      ),
  );
  rows(
    'expenses',
    'id',
    (r) =>
      strings(
        r,
        'tripId date destination category subcategory description paymentMethod notes currency',
      ) &&
      numbers(r, 'amountGBP amountLocal order createdAt') &&
      (r.cityId === null || typeof r.cityId === 'string') &&
      typeof r.skeleton === 'boolean' &&
      optional(r, 'fxPending', 'boolean') &&
      (r.fxRate === null ||
        (typeof r.fxRate === 'number' && Number.isFinite(r.fxRate) && r.fxRate > 0)),
  );
  rows('fxRates', 'code', (r) => numbers(r, 'rate fetchedAt') && r.rate > 0 && strings(r, 'date'));
  rows('settings', 'key', (r) => 'value' in r);
  const photoMeta = (r: Record<string, any>) =>
    strings(r, 'id tripId kind') &&
    numbers(r, 'createdAt') &&
    ['stop', 'receipt', 'cover'].includes(r.kind) &&
    (r.stopId === null || typeof r.stopId === 'string') &&
    (r.expenseId === null || typeof r.expenseId === 'string');
  if (!Array.isArray(data.photos)) fail('photos missing');
  const photoIds = new Set<string>();
  for (const [i, p] of data.photos.entries()) {
    if (
      !object(p) ||
      !object(p.meta) ||
      !photoMeta(p.meta) ||
      !p.meta.id.trim() ||
      photoIds.has(p.meta.id) ||
      typeof p.dataUrl !== 'string' ||
      !/^data:[^,]*;base64,[A-Za-z0-9+/]*={0,2}$/.test(p.dataUrl)
    )
      fail(`photos row ${i + 1}`);
    photoIds.add(p.meta.id);
  }
  if (data.photosMeta !== undefined) rows('photosMeta', 'id', photoMeta);
  const cities = new Map(data.cities.map((r: any) => [r.id, r.tripId]));
  const stops = new Map(data.stops.map((r: any) => [r.id, r.tripId]));
  const expenses = new Map(data.expenses.map((r: any) => [r.id, r.tripId]));
  for (const row of [...data.stops, ...data.expenses]) {
    if (row.cityId && cities.has(row.cityId) && cities.get(row.cityId) !== row.tripId)
      fail(`${row.id} links to a city in another trip`);
  }
  for (const p of [...data.photos.map((p: any) => p.meta), ...(data.photosMeta ?? [])]) {
    if (
      (p.stopId && stops.get(p.stopId) !== p.tripId) ||
      (p.expenseId && expenses.get(p.expenseId) !== p.tripId)
    )
      fail(`photo ${p.id} links to a stop or expense outside its trip`);
  }
  const tripIds = new Set(data.trips.map((r: any) => r.id));
  for (const row of [
    ...data.cities,
    ...data.stops,
    ...data.expenses,
    ...data.photos.map((p: any) => p.meta),
    ...(data.photosMeta ?? []),
  ]) {
    if (!tripIds.has(row.tripId)) fail(`${row.id} belongs to no trip in the backup`);
  }
}

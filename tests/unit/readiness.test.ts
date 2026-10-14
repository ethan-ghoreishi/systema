import { describe, it, expect } from 'vitest';
import type { City, Trip } from '../../src/lib/db';
import {
  departuresIcs,
  nextDeparture,
  readiness,
  stageAt,
  tripDepartures,
} from '../../src/lib/readiness';

const Z = (s: string) => Date.parse(`${s}Z`);
const MIN = 60_000;

const trip = (over: Partial<Trip> = {}): Trip => ({
  id: 't',
  name: '',
  type: 'weekend',
  startDate: '',
  endDate: '',
  partySize: 2,
  returnFlightAt: '',
  accommodation: true,
  status: 'active',
  planText: '',
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

// Barcelona → Bologna, home from Bologna (each leg in its own zone).
const cities: City[] = [
  {
    id: 'bcn',
    tripId: 't',
    name: 'Barcelona',
    currency: 'EUR',
    order: 0,
    arrival: '2026-10-16T09:00',
    departure: '2026-10-16T19:00',
    tz: 'Europe/Madrid',
    exit: { hub: 'BCN', journeyMin: 35, bufferMin: 90, contingencyMin: 15, transport: 'Aerobús' },
  },
  {
    id: 'blq',
    tripId: 't',
    name: 'Bologna',
    currency: 'EUR',
    order: 1,
    arrival: '2026-10-16T21:00',
    departure: '2026-10-17T15:10',
    tz: 'Europe/Rome',
    exit: { hub: 'BLQ', journeyMin: 25, bufferMin: 90, contingencyMin: 15 },
  },
];

describe('tripDepartures', () => {
  it('computes leaveBy = departure − buffer − journey − contingency, in each zone', () => {
    const [bcn, blq] = tripDepartures(trip(), cities);
    // 19:00 Madrid (17:00Z) − 140 min = 14:40 local.
    expect(bcn.leaveBy).toBe(Z('2026-10-16T14:40'));
    // 15:10 Rome (13:10Z) − 130 min = 13:00 local (11:00Z).
    expect(blq.leaveBy).toBe(Z('2026-10-17T11:00'));
    expect(blq.to).toBe('home');
  });

  it('includes leaving home when set, and fills defaults it says it assumed', () => {
    const deps = tripDepartures(trip({ outbound: { at: '2026-10-16T06:10' } }), cities);
    expect(deps[0].key).toBe('outbound');
    expect(deps[0].tz).toBe('Europe/London');
    expect(deps[0].assumed).toEqual(['journey', 'buffer']);
    expect(deps[0].leaveBy).toBe(Z('2026-10-16T05:10') - (90 + 45 + 15) * MIN);
  });

  it('defaults to the next unresolved departure, not the final flight home', () => {
    const deps = tripDepartures(trip(), cities);
    expect(nextDeparture(deps, Z('2026-10-16T10:00'))?.key).toBe('bcn');
    expect(nextDeparture(deps, Z('2026-10-16T18:00'))?.key).toBe('blq');
    expect(nextDeparture(deps, Z('2026-10-17T14:00'))).toBeNull();
  });
});

describe('stages', () => {
  const blq = tripDepartures(trip(), cities)[1];
  const at = (s: string) => stageAt(blq, Z(s));
  it('moves Later → Prepare → Leave by → Time to go → Plan B', () => {
    expect(at('2026-10-17T08:00')).toBe('later');
    expect(at('2026-10-17T10:20')).toBe('prepare'); // leaveBy 11:00Z − 45 min
    expect(at('2026-10-17T10:55')).toBe('leave-by');
    expect(at('2026-10-17T11:05')).toBe('go');
    expect(at('2026-10-17T11:20')).toBe('plan-b');
  });

  it('speaks plainly, in local time, with no seconds', () => {
    const r = readiness(blq, Z('2026-10-17T08:00'), 'Europe/Rome');
    expect(r.title).toBe('Leave for BLQ by 13:00.');
    expect(r.detail).toBe("You are on track. That's in 3 h.");
    const away = readiness(blq, Z('2026-10-17T08:00'), 'Europe/London');
    expect(away.title).toBe('Leave for BLQ by 13:00 (Bologna time).');
    const late = readiness(blq, Z('2026-10-17T12:00'), 'Europe/Rome');
    expect(late.title).toBe('Plan B for BLQ.');
    expect(late.detail).toMatch(/about 45 min before departure/);
  });
});

describe('departuresIcs', () => {
  it('writes a ready reminder and a leave-now reminder per upcoming departure', () => {
    const ics = departuresIcs(
      't',
      'Barcelona → Bologna',
      tripDepartures(trip(), cities),
      Z('2026-10-16T12:00'),
    );
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(ics).toContain('DTSTART:20261016T135500Z'); // BCN prepare: 14:40 − 45 min
    expect(ics).toContain('DTSTART:20261017T110000Z'); // BLQ leave
    expect(ics).toContain('UID:t-blq-leave@systema');
    expect(ics).toContain('SUMMARY:Leave now for BLQ');
    for (const line of ics.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it('skips reminders already in the past', () => {
    const ics = departuresIcs('t', 'x', tripDepartures(trip(), cities), Z('2026-10-17T10:30'));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1); // only BLQ leave-now
  });
});

import { describe, it, expect } from 'vitest';
import type { City, DepartPlan, Trip } from '../../src/lib/db';
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

// A booked coach has a timetable, and it does not wait. Counting back from an
// assumed journey length when the ticket says 04:35 is a guess laid over a
// fact — and the fact is what decides whether you make the flight.
describe('a ride to the airport with its own clock', () => {
  const withCoach = (over: Partial<DepartPlan> = {}) =>
    tripDepartures(
      trip({
        outbound: {
          at: '2026-10-16T06:30',
          tz: 'Europe/London',
          hub: 'STN',
          transport: 'National Express',
          transferAt: '03:50',
          transferArr: '05:00',
          contingencyMin: 10,
          ...over,
        },
      }),
      [],
    )[0];

  it('counts back from the service, not from an assumed journey', () => {
    const d = withCoach();
    expect(d.serviceAt).toBe(Z('2026-10-16T02:50'));
    // 03:50 London (02:50Z) − 10 min to reach the stop.
    expect(d.leaveBy).toBe(Z('2026-10-16T02:40'));
    // The ticket's own two times are the journey; nothing is assumed about it.
    expect(d.journeyMin).toBe(70);
    expect(d.assumed).not.toContain('journey');
    // 05:00 at Stansted for a 06:30 flight.
    expect(d.slackMin).toBe(90);
    expect(readiness(d, Z('2026-10-16T00:00'), 'Europe/London').detail).toContain('03:50');
  });

  it('says so when the booked ride cuts the margin fine', () => {
    const d = withCoach({ transferAt: '05:10', transferArr: '06:05' });
    expect(d.slackMin).toBe(25);
    expect(readiness(d, Z('2026-10-16T00:00'), 'Europe/London').detail).toContain(
      'only 25 min before',
    );
  });

  // The 23:10 coach for the 06:30 flight leaves the night before.
  it('reads a ride timed before midnight as the previous evening', () => {
    const d = withCoach({ transferAt: '23:10', transferArr: '00:30' });
    expect(d.serviceAt).toBe(Z('2026-10-15T22:10'));
    expect(d.leaveBy).toBe(Z('2026-10-15T22:00'));
  });

  // The night the clocks go forward is 23 hours long, so "a day earlier"
  // cannot be a day's worth of milliseconds: that lands two days back and the
  // coach reads as leaving on the wrong night.
  it('finds the previous evening across a clock change', () => {
    const d = tripDepartures(
      trip({
        outbound: {
          at: '2026-03-29T06:30',
          tz: 'Europe/London',
          hub: 'STN',
          transport: 'National Express',
          transferAt: '23:10',
          contingencyMin: 10,
        },
      }),
      [],
    )[0];
    // 23:10 on 28 March is still GMT, so 23:10Z — the night of the 28th.
    expect(d.serviceAt).toBe(Z('2026-03-28T23:10'));
  });

  // You cannot leave later than the coach: there is no cushion past it.
  it('makes the service the last moment you can leave', () => {
    const d = withCoach();
    expect(d.latestLeave).toBe(d.serviceAt);
    expect(stageAt(d, Z('2026-10-16T02:45'))).toBe('go');
    expect(stageAt(d, Z('2026-10-16T02:55'))).toBe('plan-b');
  });
});

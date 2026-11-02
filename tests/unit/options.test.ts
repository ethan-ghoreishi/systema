import { describe, it, expect } from 'vitest';
import {
  FINDER_DEST_TRANSFER_PP,
  FINDER_HOTEL_PER_NIGHT,
  OptionParseError,
  blockers,
  cityCount,
  describeDifference,
  fareAgeDays,
  isPast,
  optionDates,
  optionRoute,
  parseFinderCsv,
  parseGroundHours,
  priceOption,
  sortPriced,
  viewOpportunity,
  type Facts,
} from '../../src/lib/options';
import type { Opportunity, TripOption } from '../../src/lib/db';

// Real Cheap-Trip Finder output (outputs/trips_*.csv), header and all.
const HEAD =
  'City,Country,Out date,Back date,Trip,£/usable h,True £pp,Fare £pp,Status,Usable h,Ground,Cities,Overnight,Paid nights,Out,Out flights,Out £pp,Back,Back flights,Back £pp,Out link,Back link,Checked,Notes';
const FARO =
  'Faro,Portugal,2026-12-11,2026-12-12,Fri→Sat · 1 night,4.99,96.0,34.5,OK,19.2,31h15,FAO 19h,Hotel ×1,1,LTN→FAO 09:25→12:15,Ryanair 5767,19.0,FAO→LTN 19:30→22:20,easyJet 2412,15.5,https://x/out,https://x/back,2026-10-18 00:46,';
const MILAN =
  'Milan,Italy,2026-12-11,2026-12-12,Fri→Sat · 1 night,6.96,69.0,35.0,OK,9.9,17h45,MXP 10h,Airport sleep (~5h50),0,LGW→MXP 21:15→00:10+1,easyJet 8305,22.0,MXP→STN 17:55→19:00,Ryanair 8317,13.0,https://x/o,https://x/b,2026-10-18 00:46,';
const TANGIER =
  'Tangier,Morocco,2026-12-11,2026-12-12,Fri→Sat · 2 cities,8.7,164.5,78.0,OK,18.9,22h00,TNG 10h + BCN* 8h,"4 · back via BCN, night at the destination",1,STN→TNG 06:25→09:30,Region Airline 1377,26.0,TNG→BCN→LHR 07:30→20:05 (via BCN 8h25),Vueling 8515 + Vueling 7642,52.0,https://x/o,https://x/b,2026-10-17 04:54,"* = stopover city on a long layover (one ticket, connection protected)"';

const facts = (over: Partial<Facts> = {}): Facts => ({
  ukTransfer: {},
  destTransfer: {},
  hotelNight: null,
  partySize: 2,
  ...over,
});

describe('reading a finder search', () => {
  it('reads a row into an option, times, airports, fares and the finder’s own figures', () => {
    const [row] = parseFinderCsv(`${HEAD}\n${FARO}`);
    expect(row.city).toBe('Faro');
    expect(row.country).toBe('Portugal');
    expect(row.option).toMatchObject({
      outDate: '2026-12-11',
      backDate: '2026-12-12',
      outRoute: ['LTN', 'FAO'],
      backRoute: ['FAO', 'LTN'],
      outDep: '09:25',
      outArr: '12:15',
      backDep: '19:30',
      backArr: '22:20',
      outFarePP: 19,
      backFarePP: 15.5,
      finderPP: 96,
      usableH: 19.2,
      groundH: 31.25,
      paidNights: 1,
      overnight: 'Hotel ×1',
      checked: '2026-10-18 00:46',
    });
    expect(row.option.scenario).toBeUndefined();
  });

  it('keeps a landing after midnight on the next day', () => {
    const [row] = parseFinderCsv(`${HEAD}\n${MILAN}`);
    expect(row.option.outArr).toBe('00:10');
    expect(row.option.outArrDay).toBe(1);
  });

  it('reads a two-city row’s scenario, route through the stopover and quoted commas', () => {
    const [row] = parseFinderCsv(`${HEAD}\n${TANGIER}`);
    expect(row.option.scenario).toBe(4);
    expect(row.option.overnight).toBe('4 · back via BCN, night at the destination');
    expect(row.option.backRoute).toEqual(['TNG', 'BCN', 'LHR']);
    expect(row.option.backFlights).toBe('Vueling 8515 + Vueling 7642');
    expect(row.notes).toContain('connection protected');
    expect(cityCount(row.option.cities)).toBe(2);
  });

  it('gives every option its own id, so two rows never overwrite each other', () => {
    const rows = parseFinderCsv(`${HEAD}\n${FARO}\n${MILAN}\n${TANGIER}`);
    expect(new Set(rows.map((r) => r.option.id)).size).toBe(3);
  });

  // Guessing at unlabelled columns is how a fare lands in the daylight column.
  it('refuses a table with no header rather than guessing which column is which', () => {
    expect(() => parseFinderCsv(FARO)).toThrow(OptionParseError);
    expect(() => parseFinderCsv(HEAD)).toThrow(/No trips found/);
  });

  it('reads ground hours as hours and minutes', () => {
    expect(parseGroundHours('32h40')).toBe(32.67);
    expect(parseGroundHours('17h')).toBe(17);
    expect(parseGroundHours(undefined)).toBeUndefined();
  });
});

describe('what it really costs you', () => {
  const option = (over: Partial<TripOption> = {}): TripOption => ({
    id: 'o1',
    outDate: '2026-12-11',
    backDate: '2026-12-12',
    outRoute: ['STN', 'FAO'],
    backRoute: ['FAO', 'STN'],
    outDep: '06:00',
    outArr: '09:00',
    backDep: '19:30',
    backArr: '22:20',
    finderPP: 100,
    outFarePP: 20,
    backFarePP: 15,
    usableH: 20,
    paidNights: 1,
    cities: 'FAO 19h',
    ...over,
  });

  it('leaves the finder’s figure alone when the ledger has nothing to say', () => {
    const r = priceOption(option(), facts(), 'Faro');
    expect(r.totalPP).toBe(100);
    expect(r.adjustments).toEqual([]);
    expect(r.farePP).toBe(35);
  });

  // The whole point: a £9.50 assumption against £12 actually paid, twice.
  it('swaps in what the London airport has really cost, both ways', () => {
    const r = priceOption(
      option(),
      facts({ ukTransfer: { STN: { perPerson: 12, samples: 9, low: 5.95, high: 16.5 } } }),
      'Faro',
    );
    expect(r.adjustments.map((a) => a.label)).toEqual(['STN transfer out', 'STN transfer back']);
    expect(r.totalPP).toBe(105);
    expect(r.adjustments[0].basis).toBe('£12 each, the middle of 9 past journeys (£5.95–£16.50)');
  });

  it('re-prices the hotel per person per night, which a flat £60 gets most wrong', () => {
    const r = priceOption(
      option(),
      facts({ hotelNight: { perPerson: 30, samples: 4, low: 27.4, high: 43.2 } }),
      'Faro',
    );
    // £30 for the party is £15 each; the finder assumed £60, i.e. £30 each.
    expect(r.totalPP).toBe(100 + (15 - FINDER_HOTEL_PER_NIGHT / 2));
  });

  it('uses a measured transfer in a city already visited', () => {
    const r = priceOption(
      option(),
      facts({ destTransfer: { faro: { perPerson: 4, samples: 2, low: 4, high: 4 } } }),
      'Faro',
    );
    expect(r.totalPP).toBe(100 + (4 - FINDER_DEST_TRANSFER_PP));
  });

  // Missing information stays visibly missing: it is never read as zero, and
  // never quietly treated as if the assumption were a measurement.
  it('names every assumption it could not improve on', () => {
    const r = priceOption(option(), facts(), 'Faro');
    expect(r.assumed.join(' ')).toContain('STN transfer at the finder');
    expect(r.assumed.join(' ')).toContain('transfer in Faro');
    expect(r.assumed.join(' ')).toContain('hotel at the finder');
    expect(r.totalPP).toBe(100);
  });

  it('cannot invent a total when the finder gave none', () => {
    const r = priceOption(option({ finderPP: undefined }), facts(), 'Faro');
    expect(r.totalPP).toBeNull();
    expect(r.perHour).toBeNull();
  });

  it('says when you would leave home, the night before where that is true', () => {
    const r = priceOption(option({ outDep: '06:00' }), facts(), 'Faro');
    // 90 min at the airport + 45 min to get there + 15 min spare.
    expect(r.leaveHome).toEqual({ time: '03:30', dayBefore: false });
    const early = priceOption(option({ outDep: '01:00' }), facts(), 'Faro');
    expect(early.leaveHome).toEqual({ time: '22:30', dayBefore: true });
  });

  it('says when you would be home', () => {
    const r = priceOption(option({ backArr: '23:50' }), facts(), 'Faro');
    expect(r.homeBy).toEqual({ time: '00:35', dayAfter: true });
  });

  it('ages a fare in whole days', () => {
    const now = Date.parse('2026-11-01T12:00:00');
    expect(fareAgeDays('2026-10-18 00:46', now)).toBe(14);
    expect(fareAgeDays(undefined, now)).toBeNull();
    expect(fareAgeDays('not a date', now)).toBeNull();
  });

  it('refuses an option that cannot happen, and lets an expensive one through', () => {
    expect(blockers(option({ backDate: '2026-12-01' }))).toHaveLength(1);
    expect(blockers(option({ groundH: 0 }))).toHaveLength(1);
    expect(
      blockers(option({ backDate: '2026-12-11', outArr: '19:00', backDep: '09:00' })),
    ).toHaveLength(1);
    expect(blockers(option())).toEqual([]);
  });
});

describe('how a figure is explained', () => {
  // One reading is not a pattern, and a range of one is noise.
  it('never calls a single reading "the middle", and drops an empty range', () => {
    const r = priceOption(
      {
        id: 'o',
        outDate: '2027-02-12',
        backDate: '2027-02-13',
        outRoute: ['LTN', 'FAO'],
        backRoute: ['FAO', 'LTN'],
        finderPP: 96,
      },
      facts({ ukTransfer: { LTN: { perPerson: 10, samples: 1, low: 10, high: 10 } } }),
      'Faro',
    );
    expect(r.adjustments[0].basis).toBe('£10 each, from 1 past journey');
  });
});

describe('ordering and plain words', () => {
  const o = (id: string, over: Partial<TripOption> = {}): TripOption => ({
    id,
    outDate: '2026-12-11',
    backDate: '2026-12-12',
    outRoute: ['STN', 'FAO'],
    backRoute: ['FAO', 'STN'],
    outDep: '06:00',
    finderPP: 100,
    usableH: 20,
    ...over,
  });

  it('puts an unknown figure and a blocked option last, never first', () => {
    const rows = [
      priceOption(o('a', { finderPP: 120 }), facts(), 'Faro'),
      priceOption(o('b', { finderPP: undefined }), facts(), 'Faro'),
      priceOption(o('c', { finderPP: 90 }), facts(), 'Faro'),
      priceOption(o('d', { finderPP: 10, groundH: 0 }), facts(), 'Faro'),
    ];
    expect(sortPriced(rows, 'cost').map((r) => r.option.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortPriced(rows, 'daylight').map((r) => r.option.id)[3]).toBe('d');
  });

  it('explains the difference in money, daylight and the hour you get up', () => {
    const best = priceOption(o('best', { finderPP: 96, usableH: 19 }), facts(), 'Faro');
    const other = priceOption(
      o('other', { finderPP: 104, usableH: 22, outDep: '09:25' }),
      facts(),
      'Faro',
    );
    const line = describeDifference(other, best);
    expect(line).toBe('£8 more, 3 h more daylight and you leave home at 06:55 rather than 03:30.');
    expect(describeDifference(best, best)).toBe('');
  });

  it('says so plainly when the cost is not known', () => {
    const best = priceOption(o('best'), facts(), 'Faro');
    const other = priceOption(o('other', { finderPP: undefined, usableH: 20 }), facts(), 'Faro');
    expect(describeDifference(other, best)).toContain('Cost not worked out yet');
  });

  it('labels dates and routes the way a ticket reads', () => {
    expect(optionDates(o('a'))).toBe('Fri 11 – Sat 12 Dec');
    expect(optionDates(o('a', { backDate: '2026-12-11' }))).toBe('Fri 11 Dec');
    expect(optionRoute(o('a'))).toBe('STN → FAO');
    expect(optionRoute(o('a', { backRoute: ['FAO', 'LGW'] }))).toBe('STN → FAO · back FAO → LGW');
  });
});

describe('an opportunity that has quietly become history', () => {
  const opp = (dates: string[]): Opportunity => ({
    id: 'opp',
    city: 'Faro',
    options: dates.map((d, i) => ({
      id: `o${i}`,
      outDate: d,
      backDate: d,
      outRoute: ['STN', 'FAO'],
      backRoute: ['FAO', 'STN'],
      finderPP: 100,
    })),
    createdAt: 1,
  });
  const now = Date.parse('2026-11-02T09:00:00Z');

  it('hides the dates that have gone but keeps the destination', () => {
    const view = viewOpportunity(opp(['2026-10-01', '2026-12-11']), facts(), 'cost', now);
    expect(view.rows).toHaveLength(1);
    expect(view.pastCount).toBe(1);
  });

  // No shelving chore: with nothing ahead and no trip, it simply stops asking.
  it('reads as past with nothing ahead, and never while a trip was chosen', () => {
    expect(isPast(opp(['2026-10-01']), false, now)).toBe(true);
    expect(isPast(opp(['2026-10-01']), true, now)).toBe(false);
    expect(isPast(opp(['2026-12-11']), false, now)).toBe(false);
  });
});

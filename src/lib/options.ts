import type { Opportunity, TripOption } from './db';
import { MODE_DEFAULTS } from './readiness';
import { wallParts } from './tz';
import type { MeasuredCost } from './insights';
import { newId } from './ids';

/**
 * Comparing realistic ways to make a trip, without holding them in your head.
 *
 * The Cheap-Trip Finder already answers "which trips are cheap and when is it
 * light?" — it ranks on true cost per usable daylight hour. None of that is
 * recomputed here. What it cannot know is you: what getting to Stansted has
 * actually cost you, what you actually pay for a hotel night, what a transfer
 * in that city came to last time. So this module takes the finder's figure and
 * **re-prices the few inputs the ledger has measured**, names the assumptions
 * it had to leave standing, and says the difference in plain words.
 *
 * Pure: every function takes data and returns data.
 */

// The finder's own cost assumptions, from tripfinder/engine.py — the values a
// re-priced figure is measured against. They are its defaults; a run with a
// different config would move them, so each adjustment is shown with the
// assumption it replaced rather than folded silently into one number.
// ponytail: three constants mirrored from a sibling project. If they drift, the
// adjustments read slightly off and the stated assumption is the giveaway;
// carrying them in the CSV would be the fix.
export const FINDER_ORIGIN_TRANSFER_PP: Record<string, number> = {
  LHR: 6,
  LGW: 8,
  LCY: 4,
  STN: 9.5,
  LTN: 9,
  SEN: 11,
};
export const FINDER_DEFAULT_TRANSFER_PP = 8;
export const FINDER_DEST_TRANSFER_PP = 12;
export const FINDER_HOTEL_PER_NIGHT = 60;

/** A fare older than this is a guess, not a price. */
export const STALE_FARE_DAYS = 14;

// ---- Reading the finder's CSV ----

/** One row of a quoted CSV. Handles "" escapes and commas inside quotes. */
function csvRow(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

/** Split CSV text into rows, keeping newlines that sit inside quotes. */
function csvRows(text: string): string[][] {
  const lines: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of text.replace(/\r\n?/g, '\n')) {
    if (ch === '"') quoted = !quoted;
    if (ch === '\n' && !quoted) {
      lines.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) lines.push(cur);
  return lines.filter((l) => l.trim()).map(csvRow);
}

const num = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const n = Number(v.replace(/[£,]/g, '').trim());
  return Number.isFinite(n) ? n : undefined;
};

/** 'STN→NTE 06:00→08:25' or 'TNG→BCN→LHR 07:30→20:05 (via BCN 8h25)'. */
function parseLeg(v: string): {
  route: string[];
  dep?: string;
  arr?: string;
  arrDay?: number;
} {
  const m = v.match(/^([A-Z]{3}(?:→[A-Z]{3})+)\s+(\d{1,2}:\d{2})→(\d{1,2}:\d{2})(\+\d)?/);
  if (!m) return { route: [] };
  return {
    route: m[1].split('→'),
    dep: m[2].padStart(5, '0'),
    arr: m[3].padStart(5, '0'),
    ...(m[4] ? { arrDay: Number(m[4].slice(1)) } : {}),
  };
}

/** 'Hotel ×1' / '4 · back via BCN, …' — the leading number is the stopover scenario. */
function parseScenario(overnight: string): number | undefined {
  const m = overnight.match(/^([1-4])\s*·/);
  return m ? Number(m[1]) : undefined;
}

/** 'TNG 10h + BCN* 8h' → 2. '—' → 0. How many places the trip is costed for. */
export function cityCount(cities: string | undefined): number {
  if (!cities || cities.trim() === '—') return 0;
  return cities.split('+').filter((s) => s.trim()).length;
}

export interface ParsedRow {
  city: string;
  country?: string;
  option: TripOption;
  /** The finder's budget verdict, e.g. 'OK' or 'OVER +£12'. Informational. */
  status?: string;
  notes?: string;
}

export class OptionParseError extends Error {}

/**
 * Read Cheap-Trip Finder rows — a pasted CSV or the saved `.csv` file, header
 * and all. The header is required: guessing at unlabelled columns is how a
 * fare ends up in the daylight column.
 */
export function parseFinderCsv(text: string): ParsedRow[] {
  const rows = csvRows(text);
  const headIndex = rows.findIndex(
    (r) => r.includes('City') && r.some((c) => c === 'Out date' || c === 'Out Date'),
  );
  if (headIndex < 0)
    throw new OptionParseError(
      'That does not look like a Cheap-Trip Finder table. Paste the CSV including its header row (the line starting "City,Country,Out date…"), or pick the .csv file the search saved.',
    );
  const head = rows[headIndex];
  const at = (r: string[], name: string) => {
    const i = head.indexOf(name);
    return i < 0 ? undefined : r[i];
  };
  const out: ParsedRow[] = [];
  for (const r of rows.slice(headIndex + 1)) {
    const city = at(r, 'City');
    const outDate = at(r, 'Out date') ?? at(r, 'Out Date');
    if (!city || !outDate || !/^\d{4}-\d{2}-\d{2}$/.test(outDate)) continue;
    const o = parseLeg(at(r, 'Out') ?? '');
    const b = parseLeg(at(r, 'Back') ?? '');
    const overnight = at(r, 'Overnight') ?? '';
    const option: TripOption = {
      id: newId(),
      outDate,
      backDate: at(r, 'Back date') ?? at(r, 'Back Date') ?? outDate,
      outRoute: o.route,
      backRoute: b.route,
      outDep: o.dep,
      outArr: o.arr,
      backDep: b.dep,
      backArr: b.arr,
      ...(o.arrDay ? { outArrDay: o.arrDay } : {}),
      ...(b.arrDay ? { backArrDay: b.arrDay } : {}),
      outFlights: at(r, 'Out flights') || undefined,
      backFlights: at(r, 'Back flights') || undefined,
      outFarePP: num(at(r, 'Out £pp')),
      backFarePP: num(at(r, 'Back £pp')),
      finderPP: num(at(r, 'True £pp')),
      usableH: num(at(r, 'Usable h')),
      groundH: parseGroundHours(at(r, 'Ground')),
      cities: at(r, 'Cities') || undefined,
      overnight: overnight || undefined,
      paidNights: num(at(r, 'Paid nights')),
      ...(parseScenario(overnight) ? { scenario: parseScenario(overnight) } : {}),
      checked: at(r, 'Checked') || undefined,
      outLink: at(r, 'Out link') || undefined,
      backLink: at(r, 'Back link') || undefined,
    };
    out.push({
      city,
      country: at(r, 'Country') || undefined,
      option,
      status: at(r, 'Status') || undefined,
      notes: at(r, 'Notes') || undefined,
    });
  }
  if (!out.length)
    throw new OptionParseError(
      'No trips found in that table. Check it has at least one row under the header.',
    );
  return out;
}

/** '32h40' → 32.67. */
export function parseGroundHours(v: string | undefined): number | undefined {
  const m = v?.match(/^(\d+)h(\d{2})?$/);
  if (!m) return num(v);
  return Math.round((Number(m[1]) + Number(m[2] ?? 0) / 60) * 100) / 100;
}

// ---- Hard constraints ----

/**
 * Reasons an option cannot work at all, as sentences. The finder's own rows
 * clear these by construction; a typed or edited option may not. Being over
 * the search's budget is not here: that is a fact to weigh, not a refusal.
 */
export function blockers(o: TripOption): string[] {
  const out: string[] = [];
  if (o.backDate && o.outDate && o.backDate < o.outDate)
    out.push('The return is dated before the outbound.');
  if (o.groundH != null && o.groundH <= 0) out.push('There is no time on the ground.');
  if (
    o.outDate &&
    o.backDate === o.outDate &&
    o.outArr &&
    o.backDep &&
    !o.outArrDay &&
    !o.backArrDay &&
    o.backDep <= o.outArr
  )
    out.push('You would leave before you land.');
  return out;
}

// ---- Re-pricing against the ledger ----

export interface Facts {
  /** Per person, one journey, by London IATA code. */
  ukTransfer: Record<string, MeasuredCost>;
  /** Per person, by lower-cased city name. */
  destTransfer: Record<string, MeasuredCost>;
  /** For the whole party, per night. */
  hotelNight: MeasuredCost | null;
  partySize: number;
}

export interface Adjustment {
  label: string;
  /** £ per person, added to the finder's figure. */
  deltaPP: number;
  /** The plain-English basis, e.g. '£12 each, the middle of 9 past journeys'. */
  basis: string;
}

/** '£12 each, the middle of 9 past journeys (£5.95–£16.50)' — never 'the middle' of one. */
function basisOf(m: MeasuredCost, each: string, thing: string): string {
  const n = m.samples;
  const spread = m.low === m.high ? '' : ` (${pounds(m.low)}–${pounds(m.high)})`;
  const from = n === 1 ? `from 1 past ${thing}` : `the middle of ${n} past ${thing}s`;
  return `${pounds(m.perPerson)} ${each}, ${from}${spread}`;
}

/** '£10', '£34.50' — pennies only where there are any. */
export function pounds(n: number): string {
  return `£${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

export interface PricedOption {
  option: TripOption;
  blockers: string[];
  /** Fares as quoted, per person. */
  farePP: number | null;
  /** The finder's true cost per person, untouched. */
  finderPP: number | null;
  /** The finder's figure with the measured inputs swapped in. */
  totalPP: number | null;
  adjustments: Adjustment[];
  /** Finder assumptions nothing here could improve on, named rather than hidden. */
  assumed: string[];
  usableH: number | null;
  groundH: number | null;
  /** £ per usable daylight hour, on the re-priced total. */
  perHour: number | null;
  /** When you would leave home, and be back — minutes-of-day, with the day offset. */
  leaveHome: { time: string; dayBefore: boolean } | null;
  homeBy: { time: string; dayAfter: boolean } | null;
  /** Days since the fare was checked, when it is known. */
  fareAgeDays: number | null;
}

function addMinutes(hhmm: string, delta: number): { time: string; day: number } {
  const [h, m] = hhmm.split(':').map(Number);
  let total = h * 60 + m + delta;
  let day = 0;
  while (total < 0) {
    total += 1440;
    day -= 1;
  }
  while (total >= 1440) {
    total -= 1440;
    day += 1;
  }
  return {
    time: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
    day,
  };
}

/**
 * The whole comparison for one option: what it really costs you, what had to
 * stay an assumption, and the hours either end of the day.
 *
 * The cost is the finder's own figure plus one adjustment per input the ledger
 * has measured. Rebuilding its total here would mean copying its whole model
 * and then disagreeing with it over rounding; adjusting it keeps one number
 * authoritative and makes every change visible.
 */
export function priceOption(
  o: TripOption,
  facts: Facts,
  city = '',
  now = Date.now(),
): PricedOption {
  const farePP =
    o.outFarePP != null || o.backFarePP != null ? (o.outFarePP ?? 0) + (o.backFarePP ?? 0) : null;
  const adjustments: Adjustment[] = [];
  const assumed: string[] = [];

  const outHub = o.outRoute[0];
  const backHub = o.backRoute[o.backRoute.length - 1];
  for (const [hub, which] of [
    [outHub, 'out'],
    [backHub, 'back'],
  ] as const) {
    if (!hub) continue;
    const m = facts.ukTransfer[hub];
    const was = FINDER_ORIGIN_TRANSFER_PP[hub] ?? FINDER_DEFAULT_TRANSFER_PP;
    if (!m) {
      assumed.push(`${hub} transfer at the finder's £${was} each way`);
      continue;
    }
    adjustments.push({
      label: `${hub} transfer ${which}`,
      deltaPP: round2(m.perPerson - was),
      basis: basisOf(m, 'each', 'journey'),
    });
  }

  // The destination transfer, where this city has been visited before. Only
  // the named city can be looked up: a two-city row's second place is an
  // airport code, so its transfer keeps the finder's assumption, said plainly.
  const cities = cityCount(o.cities);
  const destMeasured = city ? facts.destTransfer[city.trim().toLowerCase()] : undefined;
  if (cities > 0 && destMeasured) {
    adjustments.push({
      label: `transfer in ${city}`,
      deltaPP: round2(destMeasured.perPerson - FINDER_DEST_TRANSFER_PP),
      basis: basisOf(destMeasured, 'each', 'visit'),
    });
  } else if (cities > 0) {
    assumed.push(
      `the transfer in ${city || 'the destination'} at the finder's £${FINDER_DEST_TRANSFER_PP} each`,
    );
  }
  if (cities > 1)
    assumed.push(`the second city's transfer at the finder's £${FINDER_DEST_TRANSFER_PP} each`);

  const nights = o.paidNights ?? 0;
  if (nights > 0) {
    if (facts.hotelNight) {
      const perPersonNight = facts.hotelNight.perPerson / Math.max(1, facts.partySize);
      adjustments.push({
        label: `${nights} hotel night${nights === 1 ? '' : 's'}`,
        deltaPP: round2(
          (perPersonNight - FINDER_HOTEL_PER_NIGHT / Math.max(1, facts.partySize)) * nights,
        ),
        basis: basisOf(facts.hotelNight, 'a night for the party', 'stay'),
      });
    } else {
      assumed.push(`the hotel at the finder's £${FINDER_HOTEL_PER_NIGHT} a night`);
    }
  }

  const totalPP =
    o.finderPP == null ? null : round2(o.finderPP + adjustments.reduce((a, x) => a + x.deltaPP, 0));

  const flight = MODE_DEFAULTS.flight;
  const leave = o.outDep
    ? addMinutes(o.outDep, -(flight.bufferMin + flight.journeyMin + flight.contingencyMin))
    : null;
  const back = o.backArr ? addMinutes(o.backArr, flight.journeyMin) : null;

  return {
    option: o,
    blockers: blockers(o),
    farePP: farePP == null ? null : round2(farePP),
    finderPP: o.finderPP ?? null,
    totalPP,
    adjustments,
    assumed,
    usableH: o.usableH ?? null,
    groundH: o.groundH ?? null,
    perHour: totalPP != null && o.usableH ? Math.round((totalPP / o.usableH) * 100) / 100 : null,
    leaveHome: leave ? { time: leave.time, dayBefore: leave.day < 0 } : null,
    homeBy: back ? { time: back.time, dayAfter: back.day > 0 } : null,
    fareAgeDays: fareAgeDays(o.checked, now),
  };
}

/** How long ago the fare was checked, in whole days. Null when unknown. */
export function fareAgeDays(checked: string | undefined, now = Date.now()): number | null {
  if (!checked) return null;
  const t = Date.parse(checked.trim().replace(' ', 'T'));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---- Ordering and plain words ----

export type OptionSort = 'cost' | 'daylight' | 'perHour';

export const SORT_LABEL: Record<OptionSort, string> = {
  cost: 'Cheapest',
  daylight: 'Most daylight',
  perHour: 'Best per hour',
};

/**
 * Order the options, with a blocked one and an unknown figure last — an
 * unknown is not a bad score, so it never beats a real one either way.
 */
export function sortPriced(rows: PricedOption[], by: OptionSort): PricedOption[] {
  const key = (r: PricedOption): number | null =>
    by === 'cost' ? r.totalPP : by === 'daylight' ? r.usableH : r.perHour;
  const better = by === 'daylight' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (!!a.blockers.length !== !!b.blockers.length) return a.blockers.length ? 1 : -1;
    const [ka, kb] = [key(a), key(b)];
    if (ka == null && kb == null) return a.option.outDate.localeCompare(b.option.outDate);
    if (ka == null) return 1;
    if (kb == null) return -1;
    return (ka - kb) * better || a.option.outDate.localeCompare(b.option.outDate);
  });
}

const hours = (h: number) =>
  Math.abs(h) >= 10 ? `${Math.round(h)} h` : `${Math.round(h * 10) / 10} h`;
const money = (n: number) =>
  `£${Math.abs(n) >= 10 ? Math.round(Math.abs(n)) : Math.round(Math.abs(n) * 100) / 100}`;

function minutesOfDay(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * How this option differs from the one being compared against, in a sentence.
 * Only differences that could change the decision are mentioned: pennies and
 * a few minutes are noise.
 */
export function describeDifference(row: PricedOption, best: PricedOption): string {
  if (row.option.id === best.option.id) return '';
  const bits: string[] = [];
  if (row.totalPP == null || best.totalPP == null) bits.push('cost not worked out yet');
  else {
    const d = row.totalPP - best.totalPP;
    bits.push(Math.abs(d) < 1 ? 'about the same cost' : `${money(d)} ${d > 0 ? 'more' : 'less'}`);
  }
  if (row.usableH != null && best.usableH != null) {
    const d = row.usableH - best.usableH;
    if (Math.abs(d) >= 0.5) bits.push(`${hours(d)} ${d > 0 ? 'more' : 'less'} daylight`);
  }
  const a = row.leaveHome;
  const b = best.leaveHome;
  if (a && b) {
    const d = minutesOfDay(a.time) - minutesOfDay(b.time);
    if (Math.abs(d) >= 45)
      bits.push(
        `you leave home at ${a.time}${a.dayBefore ? ' the night before' : ''} rather than ${b.time}`,
      );
  }
  if (!bits.length) return 'Much the same trip.';
  return `${bits[0][0].toUpperCase()}${bits[0].slice(1)}${bits.length > 1 ? `, ${bits.slice(1).join(' and ')}` : ''}.`;
}

/**
 * 'Fri 11 – Sat 12 Dec' from the option's dates, built from the calendar parts
 * rather than from Intl: engines word the same request differently (WebKit on
 * Linux writes 'Sat, 13 Feb'), and two of those joined by a dash read badly.
 */
export function optionDates(o: TripOption): string {
  const a = wallParts(o.outDate);
  if (!a) return o.outDate;
  const dayOf = (p: NonNullable<ReturnType<typeof wallParts>>) =>
    `${p.weekday.slice(0, 3)} ${p.day}`;
  const withMonth = (p: NonNullable<ReturnType<typeof wallParts>>) =>
    `${dayOf(p)} ${p.month.slice(0, 3)}`;
  const b = o.backDate && o.backDate !== o.outDate ? wallParts(o.backDate) : undefined;
  if (!b) return withMonth(a);
  return `${a.month === b.month ? dayOf(a) : withMonth(a)} – ${withMonth(b)}`;
}

/** 'STN → NTE, back NTE → STN' — the airports, which decide the London end. */
export function optionRoute(o: TripOption): string {
  const out = o.outRoute.join(' → ');
  const back = o.backRoute.join(' → ');
  if (!out && !back) return '';
  return back && back !== [...o.outRoute].reverse().join(' → ') ? `${out} · back ${back}` : out;
}

// ---- The whole opportunity ----

export interface OpportunityView {
  rows: PricedOption[];
  /** The leading option under the chosen order, blockers aside. */
  best: PricedOption | null;
  /** Options whose outbound date has gone. */
  pastCount: number;
}

/** Price and order every option of an opportunity, leaving gone dates out. */
export function viewOpportunity(
  opp: Opportunity,
  facts: Facts,
  by: OptionSort = 'cost',
  now = Date.now(),
): OpportunityView {
  const today = new Date(now).toISOString().slice(0, 10);
  const live = opp.options.filter((o) => o.outDate >= today);
  const rows = sortPriced(
    live.map((o) => priceOption(o, facts, opp.city, now)),
    by,
  );
  return {
    rows,
    best: rows.find((r) => !r.blockers.length) ?? null,
    pastCount: opp.options.length - live.length,
  };
}

/**
 * Whether an opportunity has quietly become history: no option still ahead of
 * us and no trip chosen from it. Nothing to tidy — it just stops asking.
 */
export function isPast(opp: Opportunity, chosen: boolean, now = Date.now()): boolean {
  if (chosen) return false;
  const today = new Date(now).toISOString().slice(0, 10);
  return !opp.options.some((o) => o.outDate >= today);
}

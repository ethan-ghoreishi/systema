import type { Opportunity, TripOption } from './db';
import { MODE_DEFAULTS } from './readiness';
import { wallParts } from './tz';
import type { MeasuredCost } from './insights';
import { parseMoney, MONEY_HINT } from './money';
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
// re-priced figure is measured against, and the fallback when a search did not
// say. A search's own `.config.json` carries the two that are configurable
// (`dest_transfer_pp`, `hotel_per_night`) plus how many travellers it priced
// for; those are read at import and kept on the option, so a re-priced figure
// is measured against the run it came from rather than against these.
// ponytail: the per-airport origin transfers are hard-coded in engine.py, not
// in the config, so they stay mirrored here. If they drift, the adjustment
// reads slightly off and the stated assumption is the giveaway; putting them in
// the config (and so in the hand-off) would be the fix.
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
/** For the whole party: bag storage on a hotel-less city day, and one eSIM. */
export const FINDER_BAG_STORAGE_PER_DAY = 6;
export const FINDER_ESIM_PER_TRIP = 3;
/** For the party, when the London departure is before 06:30 (no train that early). */
export const FINDER_EARLY_DEP_PENALTY = 25;
export const FINDER_EARLY_DEP_BEFORE = '06:30';

/** A fare older than this is a guess, not a price. */
export const STALE_FARE_DAYS = 14;

/** What one search actually priced for, read from the `.config.json` beside it. */
export interface FinderAssumptions {
  travellers?: number;
  destTransferPP?: number;
  hotelPerNight?: number;
  bagStoragePerDay?: number;
  esimPerTrip?: number;
  earlyDepPenalty?: number;
}

/**
 * Read a search's `<name>.config.json`. Only the figures that decide a
 * re-priced total are taken; the rest of the run's settings are the finder's
 * business.
 */
export function parseFinderConfig(text: string): FinderAssumptions | null {
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!cfg || typeof cfg !== 'object') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const out: FinderAssumptions = {
    travellers: n(cfg.travellers),
    destTransferPP: n(cfg.dest_transfer_pp),
    hotelPerNight: n(cfg.hotel_per_night),
    bagStoragePerDay: n(cfg.bag_storage_per_day),
    esimPerTrip: n(cfg.esim_per_trip),
    earlyDepPenalty: n(cfg.early_dep_penalty),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : null;
}

/**
 * An imported link, if it is an ordinary web address. A CSV is just a file —
 * it can say anything, including `javascript:`, and these end up behind a tap.
 * Checked again where they are rendered: rows restored from a backup or merged
 * from the NAS never passed through an import.
 */
export function safeLink(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

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

export interface ParsedSearch {
  rows: ParsedRow[];
  /** Rows that named a trip but had no flights to make it with. */
  skipped: number;
  /** The run's own cost assumptions, where its `.config.json` came too. */
  assumptions?: FinderAssumptions;
}

/**
 * Read Cheap-Trip Finder rows — a pasted CSV or the saved `.csv` file, header
 * and all. The header is required: guessing at unlabelled columns is how a
 * fare ends up in the daylight column.
 *
 * A search writes more than one table. The price map (`…_price_map.csv`) and
 * the older calendar exports have the same first four columns as the results,
 * so a header test alone reads them as a hundred destinations with no flights
 * and no fares. A real results row says which airports, at what time — so that
 * is what is required, of the table and of each row.
 */
export function parseFinderCsv(text: string): ParsedSearch {
  const rows = csvRows(text);
  const headIndex = rows.findIndex(
    (r) => r.includes('City') && r.some((c) => c === 'Out date' || c === 'Out Date'),
  );
  if (headIndex < 0)
    throw new OptionParseError(
      'That does not look like a Cheap-Trip Finder table. Paste the CSV including its header row (the line starting "City,Country,Out date…"), or pick the .csv file the search saved.',
    );
  const head = rows[headIndex];
  if (!head.includes('Out'))
    throw new OptionParseError(
      head.some((c) => c === 'Fits' || c === 'Price' || c === 'Calendar £pp')
        ? 'That is the search’s price map — the fares it found while looking, not the trips it worked out. Pick the file of the same name without "_price_map", which has the flights and times in it.'
        : 'That table has no flights in it, so there is nothing to compare. Pick the search’s own results .csv (its header runs "…Out,Out flights,Out £pp,Back…").',
    );
  if (!head.includes('Back') && head.includes('In'))
    throw new OptionParseError(
      'That is an older search format, from before the results table settled. Run the search again to get a table this can read.',
    );
  const at = (r: string[], name: string) => {
    const i = head.indexOf(name);
    return i < 0 ? undefined : r[i];
  };
  const out: ParsedRow[] = [];
  let skipped = 0;
  for (const r of rows.slice(headIndex + 1)) {
    const city = at(r, 'City');
    const outDate = at(r, 'Out date') ?? at(r, 'Out Date');
    if (!city || !outDate || !/^\d{4}-\d{2}-\d{2}$/.test(outDate)) continue;
    const o = parseLeg(at(r, 'Out') ?? '');
    const b = parseLeg(at(r, 'Back') ?? '');
    // No flights either way is a search that did not finish for this trip, not
    // a trip you could take: importing it makes a destination you cannot act on.
    if (!o.route.length || !b.route.length) {
      skipped += 1;
      continue;
    }
    for (const field of ['Out £pp', 'Back £pp', 'True £pp']) {
      const value = at(r, field);
      if (value?.trim() && parseMoney(value) == null)
        throw new OptionParseError(`${city}: ${field} is invalid or ambiguous. ${MONEY_HINT}`);
    }
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
      outFarePP: parseMoney(at(r, 'Out £pp') ?? '') ?? undefined,
      backFarePP: parseMoney(at(r, 'Back £pp') ?? '') ?? undefined,
      finderPP: parseMoney(at(r, 'True £pp') ?? '') ?? undefined,
      usableH: num(at(r, 'Usable h')),
      groundH: parseGroundHours(at(r, 'Ground')),
      cities: at(r, 'Cities') || undefined,
      overnight: overnight || undefined,
      paidNights: num(at(r, 'Paid nights')),
      ...(parseScenario(overnight) ? { scenario: parseScenario(overnight) } : {}),
      checked: at(r, 'Checked') || undefined,
      outLink: safeLink(at(r, 'Out link')),
      backLink: safeLink(at(r, 'Back link')),
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
      skipped
        ? `That table has ${skipped} trip${skipped === 1 ? '' : 's'} in it but no flights for any of them — the search had not found fares yet. Run it again, or pick a finished search.`
        : 'No trips found in that table. Check it has at least one row under the header.',
    );
  return { rows: out, skipped };
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
  /** Per person, one visit (both directions), by lower-cased city name. */
  destTransfer: Record<string, MeasuredCost>;
  /** For the whole party, per night. */
  hotelNight: MeasuredCost | null;
  /**
   * How many people a figure is divided between when nothing else says. The
   * household's usual number, not a reading taken off some other trip: an
   * option priced for two by a search that said two is not evidence about the
   * next one. A search that stated its own `travellers` overrides this.
   */
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
  /**
   * 'finder' — the search's own true cost with the measured inputs swapped in.
   * 'parts' — a hand-written option, added up from the fares it states plus
   * what the ledger knows. Both carry the same allowances (transfers, nights,
   * eSIM, bag storage, an early start), so the two figures can be ranked
   * against each other; the card still says which was used.
   */
  basis: 'finder' | 'parts';
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
  unknown: string[];
  party: number;
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

/** Drop only estimates whose inputs changed; keep the original quote's other history. */
export function invalidateOptionEstimates(next: TripOption, original: TripOption): TripOption {
  const changed = (keys: (keyof TripOption)[]) =>
    keys.some((key) => JSON.stringify(next[key]) !== JSON.stringify(original[key]));
  const timingChanged = changed([
    'outDate',
    'backDate',
    'outRoute',
    'backRoute',
    'outDep',
    'outArr',
    'backDep',
    'backArr',
    'outArrDay',
    'backArrDay',
  ]);
  const result = { ...next };
  if (timingChanged) {
    delete result.usableH;
    delete result.groundH;
  }
  if (
    original.finderPP != null &&
    (timingChanged ||
      changed([
        'outFarePP',
        'backFarePP',
        'outFareLocal',
        'backFareLocal',
        'outFareCcy',
        'backFareCcy',
        'paidNights',
        'overnight',
        'finderAssumptions',
      ]))
  ) {
    delete result.finderPP;
    result.source = 'manual';
  }
  return result;
}

export function accommodationUndecided(o: TripOption): boolean {
  // Nights unknown *and* nothing said about the night at all. A row that names
  // its arrangement ("Hotel ×1", "Airport sleep") was priced on that before
  // this existed and still is: only a blank one is genuinely undecided.
  return (
    o.source === 'manual' && o.backDate > o.outDate && o.paidNights == null && !o.overnight?.trim()
  );
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
 * For a finder row the cost is the finder's own figure plus one adjustment per
 * input the ledger has measured. Rebuilding its total here would mean copying
 * its whole model and then disagreeing with it over rounding; adjusting it
 * keeps one number authoritative and makes every change visible.
 *
 * A hand-written option has no such figure, and leaving it blank would park
 * every option typed from a Google Flights search at the bottom of the list.
 * So its parts are added up instead — the fares you state plus the same
 * transfer and hotel inputs — and `basis` says which arithmetic was used.
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
  const unknown: string[] = [];

  // A hand-written option has no finder figure to adjust, so its parts are
  // added up instead: the fares it states, plus the same inputs, measured where
  // the ledger can and named as an allowance where it cannot.
  const parts = o.source === 'manual';
  const party = Math.max(1, o.finderAssumptions?.travellers ?? facts.partySize);
  const destWas = o.finderAssumptions?.destTransferPP ?? FINDER_DEST_TRANSFER_PP;
  const hotelWas = o.finderAssumptions?.hotelPerNight ?? FINDER_HOTEL_PER_NIGHT;

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
      if (parts)
        adjustments.push({
          label: `${hub} transfer ${which}`,
          deltaPP: was,
          basis: `£${was} each, the usual allowance — your own trips have not priced it`,
        });
      else assumed.push(`${hub} transfer at the finder's £${was} each way`);
      continue;
    }
    adjustments.push({
      label: `${hub} transfer ${which}`,
      deltaPP: round2(parts ? m.perPerson : m.perPerson - was),
      basis: basisOf(m, 'each', 'journey'),
    });
  }

  // The destination transfer, where this city has been visited before. Only
  // the named city can be looked up: a two-city row's second place is an
  // airport code, so its transfer keeps the finder's assumption, said plainly.
  // ponytail: matched on the city's name alone, because a visited city is a
  // leg and a leg carries no country. Two same-named places are kept apart as
  // destinations, but a transfer measured in one would be read against the
  // other. Giving City a country would fix it, and nothing here needs one yet.
  const cities = o.cities ? cityCount(o.cities) : parts ? 1 : 0;
  const destMeasured = city ? facts.destTransfer[city.trim().toLowerCase()] : undefined;
  if (cities > 0 && destMeasured) {
    adjustments.push({
      label: `transfer in ${city}`,
      deltaPP: round2(parts ? destMeasured.perPerson : destMeasured.perPerson - destWas),
      basis: basisOf(destMeasured, 'each for the visit', 'visit'),
    });
  } else if (cities > 0 && parts) {
    adjustments.push({
      label: `transfer in ${city || 'the destination'}`,
      deltaPP: destWas,
      basis: `£${destWas} each, both ways — the usual allowance, nothing here measures it`,
    });
  } else if (cities > 0) {
    assumed.push(`the transfer in ${city || 'the destination'} at the finder's £${destWas} each`);
  }
  if (cities > 1) {
    if (parts)
      adjustments.push({
        label: "second city's transfer",
        deltaPP: destWas * (cities - 1),
        basis: `£${destWas} each per city — the search allowance`,
      });
    else assumed.push(`the second city's transfer at the finder's £${destWas} each`);
  }

  // The three allowances the finder adds for the party and nothing here can
  // measure. For its own rows they are already inside `finderPP`; a
  // hand-written option has to carry them too, or a typed option would always
  // undercut an imported one and the ranking would be a lie.
  if (parts) {
    const esim = o.finderAssumptions?.esimPerTrip ?? FINDER_ESIM_PER_TRIP;
    if (esim > 0)
      adjustments.push({
        label: 'eSIM',
        deltaPP: round2(esim / party),
        basis: `${pounds(esim)} for the party, the same allowance the finder uses`,
      });
    const bag = o.finderAssumptions?.bagStoragePerDay ?? FINDER_BAG_STORAGE_PER_DAY;
    if (bag > 0 && (o.paidNights ?? 0) === 0)
      adjustments.push({
        label: 'bag storage',
        deltaPP: round2(bag / party),
        basis: `${pounds(bag)} for the party — a day in a city with no room to leave a bag in`,
      });
    const early = o.finderAssumptions?.earlyDepPenalty ?? FINDER_EARLY_DEP_PENALTY;
    if (early > 0 && o.outDep && o.outDep < FINDER_EARLY_DEP_BEFORE)
      adjustments.push({
        label: 'early start',
        deltaPP: round2(early / party),
        basis: `${pounds(early)} for the party — nothing runs before ${FINDER_EARLY_DEP_BEFORE}, so it is a taxi`,
      });
  }

  const nights = o.paidNights ?? 0;
  if (accommodationUndecided(o)) unknown.push('Overnight accommodation has not been decided.');
  if (nights > 0) {
    if (facts.hotelNight) {
      const perPersonNight = facts.hotelNight.perPerson / party;
      adjustments.push({
        label: `${nights} hotel night${nights === 1 ? '' : 's'}`,
        deltaPP: round2((perPersonNight - (parts ? 0 : hotelWas / party)) * nights),
        basis: basisOf(
          facts.hotelNight,
          `a night for ${party === 1 ? 'one' : 'the party'}`,
          'stay',
        ),
      });
    } else if (parts) {
      adjustments.push({
        label: `${nights} hotel night${nights === 1 ? '' : 's'}`,
        deltaPP: round2((hotelWas / party) * nights),
        basis: `£${hotelWas} a night for the party — the usual allowance, nothing here measures it`,
      });
    } else {
      assumed.push(`the hotel at the finder's £${hotelWas} a night`);
    }
  }

  // One fare typed is not a trip: the other might be most of it, so a partial
  // sum would rank as the cheapest. It stays unknown until both are in.
  const base = parts
    ? o.outFarePP != null && o.backFarePP != null
      ? farePP
      : null
    : (o.finderPP ?? null);
  const totalPP =
    base == null || unknown.length
      ? null
      : round2(base + adjustments.reduce((a, x) => a + x.deltaPP, 0));

  const flight = MODE_DEFAULTS.flight;
  const leave = o.outDep
    ? addMinutes(o.outDep, -(flight.bufferMin + flight.journeyMin + flight.contingencyMin))
    : null;
  const back = o.backArr ? addMinutes(o.backArr, flight.journeyMin) : null;

  return {
    option: o,
    basis: parts ? 'parts' : 'finder',
    blockers: blockers(o),
    farePP: farePP == null ? null : round2(farePP),
    finderPP: o.finderPP ?? null,
    totalPP,
    adjustments,
    assumed,
    unknown,
    party,
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

const optionMetric = (r: PricedOption, by: OptionSort): number | null =>
  by === 'cost' ? r.totalPP : by === 'daylight' ? r.usableH : r.perHour;

/**
 * Order the options, with a blocked one and an unknown figure last — an
 * unknown is not a bad score, so it never beats a real one either way.
 */
export function sortPriced(rows: PricedOption[], by: OptionSort): PricedOption[] {
  const better = by === 'daylight' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (!!a.blockers.length !== !!b.blockers.length) return a.blockers.length ? 1 : -1;
    const [ka, kb] = [optionMetric(a, by), optionMetric(b, by)];
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

/**
 * The fares as they were really quoted: '38 JOD + €62 each (£42 + £54)'. Two
 * tickets bought separately are often sold in two currencies, and a figure
 * that only ever shows sterling cannot be checked against either receipt.
 */
export function fareWords(o: TripOption): string {
  const leg = (local?: number, ccy?: string, pp?: number) => {
    if (local != null && ccy) return `${local} ${ccy}`;
    return pp == null ? '' : pounds(pp);
  };
  const parts = [
    leg(o.outFareLocal, o.outFareCcy, o.outFarePP),
    leg(o.backFareLocal, o.backFareCcy, o.backFarePP),
  ].filter(Boolean);
  if (!parts.length) return '';
  const native = parts.join(' + ');
  const sterling =
    o.outFareCcy || o.backFareCcy
      ? [o.outFarePP, o.backFarePP]
          .filter((v): v is number => v != null)
          .map(pounds)
          .join(' + ')
      : '';
  return `${native} each${sterling ? ` (${sterling})` : ''}`;
}

/** 'STN → NTE, back NTE → STN' — the airports, which decide the London end. */
export function optionRoute(o: TripOption): string {
  const out = o.outRoute.join(' → ');
  const back = o.backRoute.join(' → ');
  if (!out && !back) return '';
  return back && back !== [...o.outRoute].reverse().join(' → ') ? `${out} · back ${back}` : out;
}

/**
 * One leg as a row can be judged by: airports, the clock at both ends, the
 * service, and the change of planes where there is one. The facts that decide
 * whether a cheap fare is a trip you would actually take.
 */
export function optionLeg(o: TripOption, which: 'out' | 'back'): string {
  const route = which === 'out' ? o.outRoute : o.backRoute;
  if (!route.length) return '';
  const dep = which === 'out' ? o.outDep : o.backDep;
  const arr = which === 'out' ? o.outArr : o.backArr;
  const day = (which === 'out' ? o.outArrDay : o.backArrDay) ?? 0;
  const flights = which === 'out' ? o.outFlights : o.backFlights;
  const bits = [route.join(' → ')];
  if (dep && arr) bits.push(`${dep}–${arr}${day ? ` +${day}` : ''}`);
  if (route.length > 2) bits.push(`change at ${route.slice(1, -1).join(', ')}`);
  else if (route.length === 2) bits.push('direct');
  if (flights) bits.push(flights);
  return bits.join(' · ');
}

// ---- The whole opportunity ----

export interface OpportunityView {
  rows: PricedOption[];
  /** The leading option under the chosen order, blockers aside. */
  best: PricedOption | null;
  /** Options whose outbound date has gone — still here, just not in the running. */
  past: PricedOption[];
  pastCount: number;
}

/**
 * Price and order every option of an opportunity. Dates that have gone are set
 * aside rather than dropped: the fares and the comparison are what you learned
 * about this place, and a window that closed is still worth seeing when the
 * next search comes in.
 */
export function viewOpportunity(
  opp: Opportunity,
  facts: Facts,
  by: OptionSort = 'cost',
  now = Date.now(),
): OpportunityView {
  const today = new Date(now).toISOString().slice(0, 10);
  const priced = opp.options.map((o) => priceOption(o, facts, opp.city, now));
  const rows = sortPriced(
    priced.filter((r) => r.option.outDate >= today),
    by,
  );
  const past = [...priced.filter((r) => r.option.outDate < today)].sort((a, b) =>
    b.option.outDate.localeCompare(a.option.outDate),
  );
  const eligible = rows.filter((r) => !r.blockers.length && optionMetric(r, by) != null);
  return {
    rows,
    best:
      by === 'daylight' || new Set(eligible.map((r) => r.party)).size < 2
        ? (eligible[0] ?? null)
        : null,
    past,
    pastCount: past.length,
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

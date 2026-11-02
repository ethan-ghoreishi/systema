import { db, type City, type Opportunity, type TripOption } from './db';
import { newId } from './ids';
import {
  DEFAULT_PARTY_SIZE,
  createTrip,
  addCity,
  applyStopoverScenario,
  recomputeTripDerived,
  updateTrip,
} from './trips';
import { destTransferByCity, hotelNightCost, ukTransferByAirport } from './insights';
import { scenarioPattern, type StopoverScenario } from './trip-shape';
import { suggestTz, HOME_TZ } from './tz';
import type { Facts, ParsedRow } from './options';

/**
 * Opportunities: the destinations under consideration, and turning the winner
 * into an ordinary trip.
 *
 * Choosing deliberately writes only what the finder's row actually states —
 * the times either end, the airports, the flight numbers, the hotel night, the
 * stopover pattern — and reports what it could not know, rather than filling
 * the gaps with plausible guesses. Nothing is priced: a quoted fare is not a
 * payment, and the ledger only ever records what was paid (see needs.ts).
 */

export async function createOpportunity(city: string, country?: string): Promise<string> {
  const id = newId();
  await db.opportunities.add({
    id,
    city: city.trim(),
    ...(country?.trim() ? { country: country.trim() } : {}),
    options: [],
    createdAt: Date.now(),
  });
  return id;
}

export async function updateOpportunity(id: string, patch: Partial<Opportunity>): Promise<void> {
  await db.opportunities.update(id, patch);
}

/**
 * Write one option into its opportunity, replacing the one with that id. The
 * options live in a list on the record, so adding, editing and removing are
 * all the same write — and a manual option is the same shape as an imported
 * one, so nothing downstream has to know which it was.
 */
export async function putOption(oppId: string, option: TripOption): Promise<void> {
  await db.transaction('rw', db.opportunities, async () => {
    const opp = await db.opportunities.get(oppId);
    if (!opp) return;
    const options = [...opp.options];
    const i = options.findIndex((o) => o.id === option.id);
    if (i < 0) options.push(option);
    else options[i] = option;
    await db.opportunities.put({ ...opp, options });
  });
}

/**
 * Drop one option. A trip already chosen from it keeps its own copy of every
 * fact that mattered (legs, times, airports), so nothing is lost there — but
 * the record of the decision is, which is why the screen asks first.
 */
export async function removeOption(oppId: string, optionId: string): Promise<void> {
  await db.transaction('rw', db.opportunities, async () => {
    const opp = await db.opportunities.get(oppId);
    if (!opp) return;
    await db.opportunities.put({
      ...opp,
      options: opp.options.filter((o) => o.id !== optionId),
    });
  });
}

/** An opportunity goes with its options; a trip chosen from it is untouched. */
export async function deleteOpportunity(id: string): Promise<void> {
  await db.opportunities.delete(id);
}

/**
 * Which destination a row belongs to. The country counts: Valencia in Spain
 * and Valencia in Venezuela are not one place, and nor are the two Tripolis.
 * A destination filed before countries were kept (or a row that names none)
 * still matches on the city alone — otherwise the next import would duplicate
 * every destination already here.
 */
function sameDestination(
  a: { city: string; country?: string },
  b: { city: string; country?: string },
): boolean {
  if (a.city.trim().toLowerCase() !== b.city.trim().toLowerCase()) return false;
  const [ca, cb] = [a.country?.trim().toLowerCase(), b.country?.trim().toLowerCase()];
  return !ca || !cb || ca === cb;
}

/** Two options describe the same trip when their dates and airports match. */
function sameConfiguration(a: TripOption, b: TripOption): boolean {
  return (
    a.outDate === b.outDate &&
    a.backDate === b.backDate &&
    a.outRoute.join() === b.outRoute.join() &&
    a.backRoute.join() === b.backRoute.join() &&
    (a.outDep ?? '') === (b.outDep ?? '') &&
    (a.backDep ?? '') === (b.backDep ?? '')
  );
}

export interface AddResult {
  /** Opportunities created, and options added or refreshed. */
  opportunities: number;
  added: number;
  refreshed: number;
}

/**
 * File the chosen finder rows under their destinations: one opportunity per
 * city, reusing the one already here. A row for a trip already listed replaces
 * it rather than stacking up — the same flights at a newer price is the same
 * option, freshly checked.
 */
export async function addFinderRows(rows: ParsedRow[]): Promise<AddResult> {
  const result: AddResult = { opportunities: 0, added: 0, refreshed: 0 };
  const byCity = new Map<string, ParsedRow[]>();
  for (const r of rows) {
    const key = `${r.city.trim().toLowerCase()}|${r.country?.trim().toLowerCase() ?? ''}`;
    (byCity.get(key) ?? byCity.set(key, []).get(key)!).push(r);
  }
  await db.transaction('rw', db.opportunities, async () => {
    const existing = await db.opportunities.toArray();
    for (const group of byCity.values()) {
      let opp = existing.find((o) => sameDestination(o, group[0]));
      if (!opp) {
        opp = {
          id: newId(),
          city: group[0].city.trim(),
          ...(group[0].country?.trim() ? { country: group[0].country.trim() } : {}),
          options: [],
          createdAt: Date.now(),
        };
        existing.push(opp);
        result.opportunities += 1;
      }
      const options = [...opp.options];
      for (const { option } of group) {
        const i = options.findIndex((o) => sameConfiguration(o, option));
        if (i < 0) {
          options.push(option);
          result.added += 1;
        } else {
          // Keep the id: the trip chosen from it still points here.
          options[i] = { ...option, id: options[i].id, note: options[i].note };
          result.refreshed += 1;
        }
      }
      await db.opportunities.put({ ...opp, options });
    }
  });
  return result;
}

// ---- Choosing one ----

/** 'YYYY-MM-DDTHH:mm' from a date, a clock time and any day the time rolls over. */
function wall(date: string, time: string | undefined, dayOffset = 0): string | undefined {
  if (!date || !time) return undefined;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return `${d.toISOString().slice(0, 10)}T${time}`;
}

/** The first flight number of a leg: 'Vueling 8515 + Vueling 7642' → 'Vueling 8515'. */
function firstFlight(v: string | undefined): string | undefined {
  return v?.split('+')[0].trim() || undefined;
}

/** The last one, which is the service that actually lands. */
function lastFlight(v: string | undefined): string | undefined {
  return v?.split('+').pop()?.trim() || undefined;
}

/** The stopover city named in '4 · back via BCN, night at the destination'. */
function viaCode(o: TripOption): string | undefined {
  return o.overnight?.match(/via\s+([A-Z]{3})/)?.[1];
}

/** The starting point that matches the option's shape. */
export function presetForOption(o: TripOption): string {
  if (o.scenario) return 'two-city';
  if (/airport sleep/i.test(o.overnight ?? '')) return 'airport-sleep';
  if ((o.paidNights ?? 0) > 0 || /hotel/i.test(o.overnight ?? '')) return 'weekend';
  if (o.outDate && o.outDate === o.backDate) return 'same-day';
  return 'weekend';
}

/** The currency this city was last visited with, so it needn't be typed again. */
function currencySeen(city: string, cities: City[]): string {
  const key = city.trim().toLowerCase();
  return cities.find((c) => c.name.trim().toLowerCase() === key)?.currency ?? '';
}

export interface ChosenTrip {
  tripId: string;
  /** What the row could not say, in plain words, for the screen to pass on. */
  toFill: string[];
}

/**
 * Turn an option into an ordinary trip: legs in order with the times the row
 * states, leaving home, the flight home, the hotel night where it falls and —
 * for a two-city row — the stopover pattern the app already knows.
 */
export async function chooseOption(opp: Opportunity, option: TripOption): Promise<ChosenTrip> {
  const toFill: string[] = [];
  const allCities = await db.cities.toArray();
  const currency = currencySeen(opp.city, allCities);
  if (!currency) toFill.push(`the currency for ${opp.city}`);
  const tripId = await createTrip(presetForOption(option));
  // The fares are per person for the party the search priced; starting the
  // trip with a different number would make its own figures disagree with the
  // one that was compared.
  const travellers = option.finderAssumptions?.travellers;

  await updateTrip(tripId, {
    opportunityId: opp.id,
    optionId: option.id,
    ...(travellers && travellers !== DEFAULT_PARTY_SIZE ? { partySize: travellers } : {}),
    outbound: {
      at: wall(option.outDate, option.outDep),
      tz: HOME_TZ,
      mode: 'flight',
      ...(option.outRoute[0] ? { hub: option.outRoute[0] } : {}),
      ...(firstFlight(option.outFlights) ? { number: firstFlight(option.outFlights) } : {}),
    },
  });

  // The city you leave from, and the service that takes you: the first flight
  // of the return route, not its last — with a connection, the last one lands
  // in London, and it is this city's departure the readiness card counts back
  // from.
  const homeExit = {
    mode: 'flight',
    ...(option.backRoute[0] ? { hub: option.backRoute[0] } : {}),
    ...(firstFlight(option.backFlights) ? { number: firstFlight(option.backFlights) } : {}),
  };
  const landing = wall(option.outDate, option.outArr, option.outArrDay ?? 0);
  const leaving = wall(option.backDate, option.backDep);

  if (option.scenario) {
    const pattern = scenarioPattern(option.scenario as StopoverScenario);
    const stopoverName = viaCode(option) ?? 'Stopover';
    await applyStopoverScenario(
      tripId,
      option.scenario as StopoverScenario,
      { name: stopoverName, currency: currencySeen(stopoverName, allCities) },
      { name: opp.city, currency },
    );
    const legs = await db.cities.where('tripId').equals(tripId).sortBy('order');
    const [first, second] = legs;
    // Whichever way round the stopover falls, both tickets touch the
    // destination: the outbound ends there and the journey home begins there.
    // So that leg gets both times. The stopover's own clock times are not in
    // the row — only the flight that leaves it — so they stay blank rather
    // than being invented.
    const [destLeg, stopLeg] =
      pattern.order === 'stopover-first' ? [second, first] : [first, second];
    if (destLeg)
      await db.cities.update(destLeg.id, {
        arrival: landing,
        departure: leaving,
        exit: { ...destLeg.exit, ...homeExit },
        ...(suggestTz(opp.city, currency) ? { tz: suggestTz(opp.city, currency) } : {}),
      });
    if (stopLeg)
      await db.cities.update(stopLeg.id, {
        exit: {
          ...stopLeg.exit,
          mode: 'flight',
          hub: stopoverName,
          // Out via the stopover, the flight on is the last of the outbound;
          // back via it, the flight home is the last of the return.
          ...(pattern.order === 'stopover-first'
            ? lastFlight(option.outFlights)
              ? { number: lastFlight(option.outFlights) }
              : {}
            : lastFlight(option.backFlights)
              ? { number: lastFlight(option.backFlights) }
              : {}),
        },
      });
    toFill.push(`the clock times in ${stopoverName}`, `the city behind the code ${stopoverName}`);
    await recomputeTripDerived(tripId);
  } else {
    const night = (option.paidNights ?? 0) > 0 || /hotel/i.test(option.overnight ?? '');
    await addCity(tripId, opp.city, currency, {
      arrival: landing,
      departure: leaving,
      sleep: night ? 'hotel' : /airport sleep/i.test(option.overnight ?? '') ? 'airport' : 'none',
      ...(suggestTz(opp.city, currency) ? { tz: suggestTz(opp.city, currency) } : {}),
      exit: homeExit,
    });
    if (night) toFill.push('where you are staying');
  }

  return { tripId, toFill };
}

// ---- What the ledger knows ----

/**
 * The measured costs an option is re-priced against, read from every trip
 * already taken. Nothing is stored: the answer moves as the ledger grows, and
 * there is no second copy to fall out of step. Read through a `liveQuery` so
 * that stays true on screen — a figure quoted from the ledger has to change
 * when the ledger does.
 *
 * The party size is the household default, not a reading taken off whichever
 * trip happens to be most recent: how many people went to Faro in March is no
 * evidence about the trip being planned, and a figure divided by the wrong
 * number is worse than one divided by a stated assumption. A search that said
 * how many travellers it priced for overrides it, per option.
 */
export async function measuredFacts(): Promise<Facts> {
  const [trips, cities, expenses, stops] = await Promise.all([
    db.trips.toArray(),
    db.cities.toArray(),
    db.expenses.toArray(),
    db.stops.toArray(),
  ]);
  return {
    ukTransfer: ukTransferByAirport(trips, expenses),
    destTransfer: destTransferByCity(trips, cities, expenses, stops),
    hotelNight: hotelNightCost(trips, cities, expenses),
    partySize: DEFAULT_PARTY_SIZE,
  };
}

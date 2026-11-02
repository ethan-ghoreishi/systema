import { db, type City, type Trip } from './db';
import { tripDepartures } from './readiness';
import { tripHotelNights, tripShape } from './trip-shape';
import { instantToWall } from './tz';

/**
 * Getting yourself ready — the half of a trip no booking covers.
 *
 * Before-you-go answers for the things the trip's own data can settle (see
 * needs.ts). This answers for the things it never will: the food, the charging,
 * the bag, the flat you are leaving. Those did live in a note, copied from the
 * last trip and edited down — which is why the note was always wrong.
 *
 * So nothing here is a static list. Each line is a rule with a reason, and a
 * trip only gets it when the reason is true of *that* trip: a 04:00 dash is
 * fed and packed nothing like a four-night multi-city break, and an airport
 * sleep needs things neither of them does. The reason is shown, so a line that
 * does not belong is obvious rather than merely unticked.
 *
 * Ticks live on the trip (`Trip.prep`), because a tick is about one trip and
 * should be deleted and backed up with it. Anything the rules miss can be
 * added by hand, and travels the same way.
 */

export type PrepGroup = 'food' | 'devices' | 'pack' | 'home';

/** The order they happen in, roughly: shop, charge, pack, lock up. */
export const GROUPS: PrepGroup[] = ['food', 'devices', 'pack', 'home'];

export const GROUP_LABEL: Record<PrepGroup, string> = {
  food: 'Food',
  devices: 'Charging',
  pack: 'Packing',
  home: 'The flat',
};

export interface PrepItem {
  key: string;
  label: string;
  /** Why this trip gets it — in the trip's own facts, not in general advice. */
  because: string;
  group: PrepGroup;
  done: boolean;
  /** Food runs in an order: buy it, make it, take it. */
  after?: string;
  /** Added by hand rather than derived. */
  own?: boolean;
}

/** The trip's own facts that the rules read. */
export interface PrepFacts {
  shape: ReturnType<typeof tripShape>['key'];
  nights: number;
  /** Clock hour you would leave home, in its own zone. */
  leaveHour: number | null;
  leaveLabel: string;
  /** The last departure's clock time — how late you get back. */
  lastDepHour: number | null;
  airportSleep: boolean;
  multiCity: boolean;
  /** Somewhere that does not spend pounds. */
  abroad: boolean;
}

/** How early is early enough that nothing is open and nothing can be bought. */
const EARLY_HOUR = 7;

export function prepFacts(trip: Trip, cities: City[]): PrepFacts {
  const legs = [...cities].sort((a, b) => a.order - b.order);
  const deps = tripDepartures(trip, legs);
  const first = deps[0];
  const last = deps[deps.length - 1];
  const hourOf = (t: number | undefined, tz: string | undefined) =>
    t == null ? null : Number(instantToWall(t, tz).slice(11, 13));
  return {
    shape: tripShape(trip, legs).key,
    nights: tripHotelNights(trip, legs),
    leaveHour: first ? hourOf(first.leaveBy, first.tz) : null,
    leaveLabel: first ? instantToWall(first.leaveBy, first.tz).slice(11, 16) : '',
    lastDepHour: last ? hourOf(last.at, last.tz) : null,
    airportSleep: legs.some((c) => c.sleep === 'airport'),
    multiCity: new Set(legs.map((c) => c.name.trim().toLowerCase()).filter(Boolean)).size > 1,
    abroad: legs.some((c) => c.currency && c.currency.toUpperCase() !== 'GBP'),
  };
}

interface Rule {
  key: string;
  group: PrepGroup;
  after?: string;
  when: (f: PrepFacts) => boolean;
  label: (f: PrepFacts) => string;
  because: (f: PrepFacts) => string;
}

const early = (f: PrepFacts) => f.leaveHour != null && f.leaveHour < EARLY_HOUR;

// Ten rules, each with the fact that earns it. Nothing general, nothing
// "useful anyway" — a line nobody would act on is a line that trains you to
// skim the list.
const RULES: Rule[] = [
  {
    key: 'food:buy',
    group: 'food',
    when: (f) => early(f) || f.shape === 'same-day' || f.airportSleep,
    label: () => 'Buy what you are taking',
    because: (f) =>
      early(f)
        ? `you leave at ${f.leaveLabel}, and nothing is open on the way`
        : f.airportSleep
          ? 'a night at the airport is a long time between meals'
          : 'a day out and back leaves no time to find lunch',
  },
  {
    key: 'food:make',
    group: 'food',
    after: 'food:buy',
    when: (f) => early(f) || f.airportSleep,
    label: () => 'Make it up the night before',
    because: (f) =>
      early(f) ? `${f.leaveLabel} is no hour to be making sandwiches` : 'nothing opens airside',
  },
  {
    key: 'food:take',
    group: 'food',
    after: 'food:make',
    when: (f) => early(f) || f.shape === 'same-day' || f.airportSleep,
    label: () => 'Take it out of the fridge',
    because: () => 'the step that gets missed at the door',
  },
  {
    key: 'food:back',
    group: 'food',
    when: (f) => f.nights >= 2 || (f.lastDepHour != null && f.lastDepHour >= 18),
    label: () => 'Something in for getting back',
    because: (f) =>
      f.lastDepHour != null && f.lastDepHour >= 18
        ? 'the last flight is an evening one, so you are home late and hungry'
        : `${f.nights} nights away means an empty fridge`,
  },
  {
    key: 'devices:charge',
    group: 'devices',
    when: () => true,
    label: (f) => (f.airportSleep ? 'Charge everything, battery pack included' : 'Charge up'),
    because: (f) =>
      f.airportSleep
        ? 'a night at the airport with no socket is a dead phone by morning'
        : 'boarding passes, maps and the plan all live on the phone',
  },
  {
    key: 'devices:adapter',
    group: 'devices',
    when: (f) => f.abroad && f.nights >= 1,
    label: () => 'Cables and an adapter',
    because: () => 'a night away means charging somewhere else',
  },
  {
    key: 'pack:day',
    group: 'pack',
    when: (f) => f.shape === 'same-day' || (f.nights === 0 && !f.airportSleep),
    label: () => 'A day bag only',
    because: () => 'out and back in a day — nothing to check, nothing to drag',
  },
  {
    key: 'pack:airport-night',
    group: 'pack',
    when: (f) => f.airportSleep,
    label: () => 'A warm layer and something over your eyes',
    because: () => 'airports are cold and lit all night',
  },
  {
    key: 'pack:nights',
    group: 'pack',
    when: (f) => f.nights >= 1,
    label: (f) => `Pack for ${f.nights} night${f.nights === 1 ? '' : 's'}`,
    because: (f) =>
      f.multiCity
        ? 'and one bag that moves — nothing to repack at each stop'
        : 'what the legs add up to',
  },
  {
    key: 'home:leaving',
    group: 'home',
    when: (f) => f.nights >= 2,
    label: () => 'Bins, plants, heating',
    because: (f) => `${f.nights} nights is long enough for the flat to notice`,
  },
];

/**
 * What this trip asks of you, in the order it happens. Pure: the screen passes
 * the trip and its legs.
 */
export function prepItems(trip: Trip, cities: City[]): PrepItem[] {
  const f = prepFacts(trip, cities);
  const done = new Set(trip.prep?.done ?? []);
  const items: PrepItem[] = RULES.filter((r) => r.when(f)).map((r) => ({
    key: r.key,
    label: r.label(f),
    because: r.because(f),
    group: r.group,
    done: done.has(r.key),
    ...(r.after ? { after: r.after } : {}),
  }));
  const keys = new Set(items.map((i) => i.key));
  // A step that follows one the trip never got stands on its own.
  for (const i of items) if (i.after && !keys.has(i.after)) delete i.after;
  for (const text of trip.prep?.extra ?? []) {
    const key = `own:${text}`;
    items.push({
      key,
      label: text,
      because: 'yours',
      group: 'home',
      done: done.has(key),
      own: true,
    });
  }
  return items;
}

/** How long before leaving this starts being worth looking at. */
export const PREP_WINDOW_DAYS = 7;

/**
 * Whether to put it on screen at all. Eight lines three months out is clutter;
 * the same eight the night before are the difference between eating on the
 * plane and not.
 */
export function prepIsDue(trip: Trip, cities: City[], now = Date.now()): boolean {
  if (trip.status === 'done') return false;
  if (trip.status === 'active') return true;
  const deps = tripDepartures(trip, [...cities]);
  if (!deps.length) return false;
  const first = deps[0].at;
  return first > now - 86_400_000 && first - now < PREP_WINDOW_DAYS * 86_400_000;
}

// ---- Ticking one ----

const prepOf = (trip: Trip) => ({
  done: [...(trip.prep?.done ?? [])],
  extra: [...(trip.prep?.extra ?? [])],
});

/** Tick or untick one line. */
export async function setPrepDone(trip: Trip, key: string, value: boolean): Promise<void> {
  const prep = prepOf(trip);
  prep.done = value ? [...new Set([...prep.done, key])] : prep.done.filter((k) => k !== key);
  await db.trips.update(trip.id, { prep, updatedAt: Date.now() });
}

/** Add something the rules did not think of, or take it away again. */
export async function setOwnPrep(trip: Trip, text: string, keep: boolean): Promise<void> {
  const t = text.trim();
  if (!t) return;
  const prep = prepOf(trip);
  prep.extra = keep ? [...new Set([...prep.extra, t])] : prep.extra.filter((x) => x !== t);
  if (!keep) prep.done = prep.done.filter((k) => k !== `own:${t}`);
  await db.trips.update(trip.id, { prep, updatedAt: Date.now() });
}

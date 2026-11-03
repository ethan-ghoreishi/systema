import { db, type City, type Trip } from './db';
import { tripDepartures } from './readiness';
import { tripHotelNights, tripShape } from './trip-shape';
import { HOME_TZ, instantToWall, wallToInstant } from './tz';

/**
 * Getting yourself ready — the half of a trip no booking covers.
 *
 * Before-you-go answers for the things the trip's own data can settle (see
 * needs.ts). This answers for the things it never will: the food, the charging,
 * the bag, the flat you are leaving. Those did live in a note, copied from the
 * last trip and edited down — which is why the note was always wrong.
 *
 * The lines come from what those notes actually said, trip after trip: the
 * camera with its belt, battery and charger; a fully charged Watch and phone;
 * the Revolut card, the cash and the passports; nuts, coffee, bananas, cake,
 * boiled eggs and cheese; the allergy pills, sunglasses, sunscreen and
 * sanitiser. Tickets and boarding passes are left out — Before-you-go already
 * answers for those from the trip's own data.
 *
 * A few of those are standing items on every trip, and they are rules with no
 * condition. The rest only appear when the trip earns them: a 04:00 dash is
 * fed and packed nothing like a four-night multi-city break, and an airport
 * sleep needs things neither of them does. The reason is shown, so a line that
 * does not belong is obvious rather than merely unticked. It is a short table
 * of rules, not a packing engine: twelve lines of data, no settings.
 *
 * Ticks live on the trip (`Trip.prep`), because a tick is about one trip and
 * should be deleted and backed up with it. Anything the rules miss can be
 * added by hand, and travels the same way.
 */

export type PrepGroup = 'food' | 'devices' | 'papers' | 'pack' | 'home' | 'other';

/** The order they happen in, roughly: shop, charge, gather, pack, lock up. */
export const GROUPS: PrepGroup[] = ['food', 'devices', 'papers', 'pack', 'home', 'other'];

export const GROUP_LABEL: Record<PrepGroup, string> = {
  food: 'Food',
  devices: 'Charging and the camera',
  papers: 'Cards and papers',
  pack: 'Packing',
  home: 'Leaving the flat',
  other: 'Anything else',
};

export function isPrepGroup(v: string | undefined): v is PrepGroup {
  return !!v && (GROUPS as string[]).includes(v);
}

export interface PrepItem {
  key: string;
  label: string;
  /** Why this trip gets it — in the trip's own facts, not in general advice. */
  because: string;
  group: PrepGroup;
  done: boolean;
  /** Food runs in an order: buy it, make it, take it. */
  after?: string;
  /** The label of the line this one follows, when there is one. */
  afterLabel?: string;
  /** Added by hand rather than derived. */
  own?: boolean;
  /** Put aside as not applying to this trip. Kept, so it can come back. */
  skipped?: boolean;
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
  /** When the flight home lands, where the trip knows it: the better fact of the two. */
  homeHour: number | null;
  homeLabel: string;
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
  const homeTz = trip.homeward?.tz ?? HOME_TZ;
  const homeAt = wallToInstant(trip.homeward?.at, homeTz);
  return {
    shape: tripShape(trip, legs).key,
    nights: tripHotelNights(trip, legs),
    leaveHour: first ? hourOf(first.leaveBy, first.tz) : null,
    leaveLabel: first ? instantToWall(first.leaveBy, first.tz).slice(11, 16) : '',
    lastDepHour: last ? hourOf(last.at, last.tz) : null,
    homeHour: hourOf(homeAt, homeTz),
    homeLabel: homeAt == null ? '' : instantToWall(homeAt, homeTz).slice(11, 16),
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

// Twelve rules, each with the fact that earns it. Nothing general, nothing
// "useful anyway" — a line nobody would act on is a line that trains you to
// skim the list.
const RULES: Rule[] = [
  {
    key: 'food:buy',
    group: 'food',
    when: (f) => early(f) || f.shape === 'same-day' || f.airportSleep,
    label: () => 'Buy the food — nuts, coffee, bananas, cake, eggs, cheese',
    because: (f) =>
      early(f)
        ? `you leave at ${f.leaveLabel}, and nothing is open on the way`
        : f.airportSleep
          ? 'a night at the airport is a long time between meals'
          : 'a day out and back leaves no time to go looking for lunch',
  },
  {
    key: 'food:make',
    group: 'food',
    after: 'food:buy',
    when: (f) => early(f) || f.airportSleep,
    label: () => 'Boil the eggs and make it up, the night before',
    because: (f) =>
      early(f) ? `${f.leaveLabel} is no hour to be boiling eggs` : 'nothing opens airside',
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
    when: (f) =>
      f.nights >= 2 ||
      (f.homeHour != null && f.homeHour >= 19) ||
      (f.homeHour == null && f.lastDepHour != null && f.lastDepHour >= 18),
    label: () => 'Something in for getting back',
    because: (f) =>
      f.homeHour != null && f.homeHour >= 19
        ? `you land back at ${f.homeLabel}, with nothing open after that`
        : f.homeHour == null && f.lastDepHour != null && f.lastDepHour >= 18
          ? 'the last flight is an evening one, so you are home late and hungry'
          : `${f.nights} nights away means an empty fridge`,
  },
  {
    key: 'devices:charge',
    group: 'devices',
    when: () => true,
    label: (f) =>
      f.airportSleep
        ? 'Charge the Watch, the phone and the battery pack'
        : 'Charge the Watch and the phone',
    because: (f) =>
      f.airportSleep
        ? 'a night at the airport with no socket is a dead phone by morning'
        : 'boarding passes, maps and the plan all live on the phone',
  },
  {
    key: 'devices:camera',
    group: 'devices',
    when: () => true,
    label: () => 'Camera: belt, spare battery, charger',
    because: () => 'the charger is the one that gets left behind',
  },
  {
    key: 'devices:adapter',
    group: 'devices',
    when: (f) => f.abroad && f.nights >= 1,
    label: () => 'Cables and an adapter',
    because: () => 'a night away means charging somewhere else',
  },
  {
    key: 'papers:cards',
    group: 'papers',
    when: (f) => f.abroad,
    label: () => 'Revolut card, cash and the passports',
    because: () => 'leaving the country',
  },
  {
    key: 'papers:pills',
    group: 'papers',
    when: () => true,
    label: () => 'Allergy pills, sunglasses, sunscreen, sanitiser',
    because: () => 'the standing four, on every trip',
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
 * What this trip asks of you, in the order it happens — including the lines
 * put aside, flagged rather than dropped, so a rule that does not fit this
 * trip can be set down without disappearing for good. Pure: the screen passes
 * the trip and its legs.
 */
export function prepItems(trip: Trip, cities: City[]): PrepItem[] {
  const f = prepFacts(trip, cities);
  const done = new Set(trip.prep?.done ?? []);
  const skipped = new Set(trip.prep?.skipped ?? []);
  const groups = trip.prep?.groups ?? {};
  const items: PrepItem[] = RULES.filter((r) => r.when(f)).map((r) => ({
    key: r.key,
    label: r.label(f),
    because: r.because(f),
    group: r.group,
    done: done.has(r.key),
    ...(skipped.has(r.key) ? { skipped: true } : {}),
    ...(r.after ? { after: r.after } : {}),
  }));
  const byKey = new Map(items.map((i) => [i.key, i]));
  // A step that follows one the trip never got — or one put aside — stands on
  // its own; otherwise it names what it waits for, rather than just looking
  // greyed out for no stated reason.
  for (const i of items) {
    const before = i.after ? byKey.get(i.after) : undefined;
    if (!before || before.skipped) delete i.after;
    else i.afterLabel = before.label;
  }
  for (const text of trip.prep?.extra ?? []) {
    const key = `own:${text}`;
    const group = groups[text];
    items.push({
      key,
      label: text,
      because: 'yours',
      // Where you filed it. Everything of your own used to land under the
      // flat, which is only right for the things about the flat.
      group: isPrepGroup(group) ? group : 'other',
      done: done.has(key),
      ...(skipped.has(key) ? { skipped: true } : {}),
      own: true,
    });
  }
  return items;
}

/**
 * Lines you have added on other trips, offered on this one. A standing item is
 * a standing item; typing "pick up the parcel" again every time is the Notes
 * list this is meant to replace. Nothing is added by itself — these are only
 * one-tap suggestions.
 */
export function ownPrepSuggestions(trips: Trip[], tripId: string): string[] {
  const here = new Set(trips.find((t) => t.id === tripId)?.prep?.extra ?? []);
  const seen = new Map<string, number>();
  for (const t of trips) {
    if (t.id === tripId) continue;
    for (const text of t.prep?.extra ?? [])
      if (!here.has(text)) seen.set(text, Math.max(seen.get(text) ?? 0, t.updatedAt ?? 0));
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([text]) => text);
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
  skipped: [...(trip.prep?.skipped ?? [])],
  groups: { ...(trip.prep?.groups ?? {}) },
});

/** Tick or untick one line. */
export async function setPrepDone(trip: Trip, key: string, value: boolean): Promise<void> {
  const prep = prepOf(trip);
  prep.done = value ? [...new Set([...prep.done, key])] : prep.done.filter((k) => k !== key);
  await db.trips.update(trip.id, { prep, updatedAt: Date.now() });
}

/** Put a line aside as not applying to this trip, or bring it back. */
export async function setPrepSkipped(trip: Trip, key: string, value: boolean): Promise<void> {
  const prep = prepOf(trip);
  prep.skipped = value
    ? [...new Set([...prep.skipped, key])]
    : prep.skipped.filter((k) => k !== key);
  await db.trips.update(trip.id, { prep, updatedAt: Date.now() });
}

/**
 * Add something the rules did not think of, or take it away again. `group`
 * says which section it belongs in — anything of your own went under the flat
 * before, whatever it was about.
 */
export async function setOwnPrep(
  trip: Trip,
  text: string,
  keep: boolean,
  group: PrepGroup = 'other',
): Promise<void> {
  const t = text.trim();
  if (!t) return;
  const prep = prepOf(trip);
  prep.extra = keep ? [...new Set([...prep.extra, t])] : prep.extra.filter((x) => x !== t);
  if (keep) prep.groups[t] = group;
  else {
    prep.done = prep.done.filter((k) => k !== `own:${t}`);
    prep.skipped = prep.skipped.filter((k) => k !== `own:${t}`);
    delete prep.groups[t];
  }
  await db.trips.update(trip.id, { prep, updatedAt: Date.now() });
}

/** Reword a line of your own, keeping its section and its tick. */
export async function renameOwnPrep(trip: Trip, from: string, to: string): Promise<void> {
  const next = to.trim();
  const old = from.trim();
  if (!next || next === old) return;
  const prep = prepOf(trip);
  if (!prep.extra.includes(old)) return;
  prep.extra = [...new Set(prep.extra.map((x) => (x === old ? next : x)))];
  const group = prep.groups[old];
  if (group) {
    delete prep.groups[old];
    prep.groups[next] = group;
  }
  const rekey = (list: string[]) => list.map((k) => (k === `own:${old}` ? `own:${next}` : k));
  prep.done = rekey(prep.done);
  prep.skipped = rekey(prep.skipped);
  await db.trips.update(trip.id, { prep, updatedAt: Date.now() });
}

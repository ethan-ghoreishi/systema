import { db, type City, type DepartPlan, type Expense, type Stop, type Trip } from './db';
import { cityBlock } from './headings';
import { newId } from './ids';
import { lastPaymentMethod, sharedDestination } from './expense-defaults';
import { withFxNote } from './expenses';
import { researchCities } from './prompt';
import { tripDepartures } from './readiness';
import { recomputeTripDerived } from './trips';
import { todayIso } from './sheet';

/**
 * "Before you go": what is still unresolved, worked out from the trip rather
 * than kept as a list to tick.
 *
 * Nothing here is a task. Each need names a thing that has to exist before
 * departure, and how far along it is comes from the trip's own data: a booking
 * reference, a hotel actually held, a payment in the ledger. So a 25-item
 * checklist shrinks to the few things actually outstanding, and the list
 * empties itself as the trip comes together — nothing to mark off, nothing to
 * go stale.
 *
 * Four states, because three of them are different things and conflating them
 * is how a trip reads as ready when it is not:
 *
 * - **open** — nothing known.
 * - **planned** — you know how you are doing it. The coach is the 9:05; you
 *   have not bought a ticket. Enough for a ride you pay for on the day,
 *   nowhere near enough for a bed or a seat.
 * - **booked** — it is held: there is a reference, or a reservation that cost
 *   nothing (a timed entry).
 * - **paid** — the ledger has the payment.
 *
 * The one thing no data can answer is checking in: the window differs by
 * airline and leaves no trace, so it is a plain tick (DepartPlan.checkedIn),
 * and it only appears once the flight is close.
 */

/** How far ahead of a flight checking in starts being worth asking about. */
const CHECKIN_WINDOW_MS = 48 * 3_600_000;

export type NeedKind =
  | 'flight'
  | 'transfer-uk'
  | 'transfer'
  | 'hotel'
  | 'plan'
  | 'book'
  | 'checkin';

/** See the module note. 'settled' is for the ones that are simply there or not. */
export type NeedState = 'open' | 'planned' | 'booked' | 'paid' | 'settled';

export const STATE_WORD: Record<NeedState, string> = {
  open: 'not sorted',
  planned: 'planned, not booked',
  booked: 'booked',
  paid: 'paid',
  settled: 'done',
};

/**
 * Whether a state settles a need. A ride you buy at the machine is sorted once
 * you know which ride it is — but only once you have said that is what it is:
 * picking "Coach" from a list is choosing how to travel, not holding a ticket,
 * and a trip that reads as sorted because of it is a trip you miss. A bed, a
 * seat or a timed entry is never sorted until it is actually held, however firm
 * the intention.
 */
export function settles(kind: NeedKind, state: NeedState, payOnDay = false): boolean {
  if (state === 'open') return false;
  if (state === 'planned') return payOnDay && (kind === 'transfer' || kind === 'transfer-uk');
  return true;
}

/**
 * Rides nobody books: you walk, you tap in, you flag one down. Saying so is
 * what settles them, and these say it for themselves.
 */
const NEVER_BOOKED = /\b(walk|walking|metro|underground|tube|taxi|uber|cab|on foot)\b/i;

export function groundJourneySpecified(plan: DepartPlan): boolean {
  const clock = (s?: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s ?? '');
  return (
    !!plan.transport?.trim() &&
    ((Number.isFinite(plan.journeyMin) && Number(plan.journeyMin) > 0) ||
      (clock(plan.transferAt) && clock(plan.transferArr) && plan.transferAt !== plan.transferArr))
  );
}

/** What the booking sheet should write into the ledger for this need. */
export interface BookSpec {
  category: string;
  subcategory: string;
  description: string;
  /** Trip-wide (flights, the UK end) rather than one city's spend. */
  shared?: boolean;
  cityId?: string | null;
  /** Ask for how you get there and how long it takes, as well as the money. */
  asksTransport?: boolean;
  /** Ask where you are staying. */
  asksPlace?: boolean;
}

export interface Need {
  /** Stable across rebuilds, and what a booked expense is stamped with. */
  key: string;
  kind: NeedKind;
  label: string;
  detail: string;
  state: NeedState;
  /** `settles(kind, state)` — nothing more to do about this one before leaving. */
  done: boolean;
  /** Why it reads as done — shown in the settled list, so nothing is mysterious. */
  evidence?: string;
  /** Present when money settles it. */
  book?: BookSpec;
  /** Present when it is settled somewhere else in the app instead. */
  href?: string;
  /** Present for a check-in tick: the departure it belongs to. */
  departureKey?: string;
}

/**
 * The payment that settles a need: one stamped with it, or — for a row
 * captured before stamps existed, or typed by hand — an unstamped one whose
 * description is exactly the one this need seeds. Those words only ever come
 * from the preset, so the match is safe, and without it a trip whose flights
 * were paid for last month would be asked to book them again.
 *
 * `also` names a key this need has taken over from, so a transfer paid for
 * before the two directions were told apart still reads as paid.
 */
const paid = (
  expenses: Expense[],
  key: string,
  description?: string,
  also?: string,
): Expense | undefined =>
  expenses.find(
    (e) =>
      !e.skeleton &&
      (e.amountGBP > 0 || (e.fxPending && e.amountLocal > 0)) &&
      (e.need === key ||
        (!!also && e.need === also) ||
        (e.need == null &&
          !!description &&
          e.description.trim().toLowerCase() === description.trim().toLowerCase())),
  );

const gbp = (n: number) => `£${Number.isInteger(n) ? n : n.toFixed(2)}`;
const paymentWords = (row: Expense) =>
  row.fxPending ? 'Paid — GBP amount pending' : gbp(row.amountGBP);

/** 'quoted £74' — what the chosen option said this would cost, before anything was paid. */
const quoted = (row: Expense | undefined): string | undefined =>
  row?.quote && row.quote.amountGBP > 0 ? `quoted ${gbp(row.quote.amountGBP)}` : undefined;

/** The row carrying this need, paid or not — a skeleton row holds the quote. */
const rowFor = (expenses: Expense[], key: string): Expense | undefined =>
  expenses.find((e) => e.need === key);

/**
 * One journey on the ground, in whichever state its own record puts it: a
 * reference means it is held, a mode and a time mean you know how you are
 * going, and neither means nothing is sorted. The transfer's reference is
 * never the service's (`transferRef`, not `ref`): a booked coach to Stansted
 * says nothing about whether the flight is booked.
 */
function groundNeed(
  key: string,
  label: string,
  plan: DepartPlan,
  row: Expense | undefined,
  book: BookSpec,
  kind: NeedKind = 'transfer',
  quote?: string,
  coverageHeld = false,
): Need {
  const ref = plan.transferRef?.trim();
  const how = plan.transport?.trim();
  const covered = coverageHeld;
  const specified = groundJourneySpecified(plan);
  const payOnDay = specified && (plan.payOnDay === true || NEVER_BOOKED.test(how!));
  const timed = plan.transferAt?.trim()
    ? `the ${plan.transferAt.trim()}${plan.transferArr?.trim() ? `, in at ${plan.transferArr.trim()}` : ''}`
    : '';
  const way = [how, timed || (plan.journeyMin != null ? `${plan.journeyMin} min` : '')]
    .filter(Boolean)
    .join(', ');
  const state: NeedState = row ? 'paid' : ref || covered ? 'booked' : way ? 'planned' : 'open';
  const done = settles(kind, state, payOnDay);
  return {
    key,
    kind,
    label,
    detail:
      state === 'open'
        ? (quote ?? 'Not sorted yet')
        : state === 'planned'
          ? `${way} — ${payOnDay ? 'you pay on the day' : 'not booked yet'}`
          : way || STATE_WORD[state],
    state,
    done,
    evidence: row
      ? paymentWords(row)
      : ref
        ? `${way ? `${way} · ` : ''}booking ${ref}`
        : covered
          ? `${way ? `${way} · ` : ''}on the same return ticket`
          : way
            ? `${way} — ${payOnDay ? 'pay on the day' : 'not booked yet'}`
            : undefined,
    book,
  };
}

/**
 * A reference an older version wrote into the flight's slot. Before the two
 * had separate keys, booking a leg's transfer put its reference in
 * `exit.ref` — where the flight home's belongs — so a booked coach read as a
 * booked flight. The payment it was recorded against says which it really is:
 * that row's note carries the same reference.
 */
function strayTransferRef(leg: City | undefined, expenses: Expense[]): string | undefined {
  const ref = leg?.exit?.ref?.trim();
  if (!leg || !ref) return undefined;
  return expenses.some(
    (e) => e.need === `transfer:${leg.id}` && e.notes.trim() === `Booking ${ref}`,
  )
    ? ref
    : undefined;
}

const UK_TRANSFER: Omit<BookSpec, 'description'> = {
  category: 'Transportation',
  subcategory: 'Airport Transfer (UK)',
  shared: true,
  cityId: null,
  asksTransport: true,
};

/**
 * Everything still to sort out before this trip, and everything already
 * settled, in the order it tends to happen. Pure: the screen passes the data
 * and the clock.
 */
export function tripNeeds(
  trip: Trip,
  cities: City[],
  expenses: Expense[],
  stops: Stop[],
  now = Date.now(),
): Need[] {
  const legs = [...cities].sort((a, b) => a.order - b.order);
  const last = legs[legs.length - 1];
  const out: Need[] = [];
  const ob = trip.outbound ?? {};
  const stray = strayTransferRef(last, expenses);
  // Coverage follows the purchase or reservation, never a stale marker alone.
  const coverageHeld = (plan: DepartPlan | undefined, other: DepartPlan | undefined, key: string) =>
    plan?.coveredBy === key && !!(other?.transferRef?.trim() || paid(expenses, key));

  // --- The two tickets ---
  for (const t of [
    {
      key: 'flight:outbound',
      label: 'Ticket out',
      ref: ob.ref?.trim(),
      row: paid(expenses, 'flight:outbound', 'Outbound flight'),
      detail: [ob.hub, ob.number].filter(Boolean).join(' ') || 'Leaving London',
      description: 'Outbound flight',
    },
    {
      key: 'flight:inbound',
      label: 'Ticket home',
      ref: last?.exit?.ref?.trim() === stray ? undefined : last?.exit?.ref?.trim(),
      row: paid(expenses, 'flight:inbound', 'Inbound flight'),
      detail:
        [last?.exit?.hub, last?.exit?.number].filter(Boolean).join(' ') ||
        (last ? `Leaving ${last.name}` : 'The flight home'),
      description: 'Inbound flight',
    },
  ]) {
    const state: NeedState = t.row ? 'paid' : t.ref ? 'booked' : 'open';
    const quote = quoted(rowFor(expenses, t.key));
    out.push({
      key: t.key,
      kind: 'flight',
      label: t.label,
      // What the fare was when the trip was chosen, until it is actually
      // bought: a quote the ledger deliberately does not hold as a payment.
      detail: [t.detail, state === 'paid' ? '' : quote].filter(Boolean).join(' · '),
      state,
      done: settles('flight', state),
      evidence: t.ref ? `Booking ${t.ref}` : t.row ? paymentWords(t.row) : undefined,
      book: {
        category: 'Transportation',
        subcategory: 'Flight',
        description: t.description,
        shared: true,
        cityId: null,
      },
    });
  }

  // --- The London end: two journeys, not one ---
  // Getting home from the airport is not the way out in reverse — a different
  // hour, often a different airport, and sometimes nothing like the same fare.
  out.push(
    groundNeed(
      'transfer-uk:out',
      `Getting to ${ob.hub || 'the airport'}`,
      ob,
      paid(expenses, 'transfer-uk:out', 'Airport transfer (UK) — outbound'),
      { ...UK_TRANSFER, description: 'Airport transfer (UK) — outbound' },
      'transfer-uk',
      quoted(rowFor(expenses, 'transfer-uk:out')),
      coverageHeld(ob, trip.homeward, 'transfer-uk:back'),
    ),
    groundNeed(
      'transfer-uk:back',
      `Getting home from ${trip.homeward?.hub?.trim() || 'the airport'}`,
      trip.homeward ?? {},
      paid(expenses, 'transfer-uk:back', 'Airport transfer (UK) — return'),
      { ...UK_TRANSFER, description: 'Airport transfer (UK) — return' },
      'transfer-uk',
      quoted(rowFor(expenses, 'transfer-uk:back')),
      coverageHeld(trip.homeward, ob, 'transfer-uk:out'),
    ),
  );

  // --- Each city: the way in, the way out, and a bed where one is needed ---
  legs.forEach((leg, i) => {
    const name = leg.name || 'the next city';
    // How you arrived decides the word: a flight lands at an airport, a train
    // comes into a station.
    const arriveBy = (i === 0 ? ob.mode : legs[i - 1].exit?.mode) ?? 'flight';
    const arrivalPoint =
      leg.entry?.hub?.trim() ||
      (arriveBy === 'flight'
        ? 'the airport'
        : arriveBy === 'train'
          ? 'the station'
          : 'where you land');
    if (leg.arrival)
      out.push(
        groundNeed(
          `transfer-in:${leg.id}`,
          `Getting into ${name} from ${arrivalPoint}`,
          leg.entry ?? {},
          paid(expenses, `transfer-in:${leg.id}`),
          {
            category: 'Transportation',
            subcategory: 'Airport Transfer (Abroad)',
            description: `Airport transfer into ${name}`,
            cityId: leg.id,
            asksTransport: true,
          },
          'transfer',
          undefined,
          coverageHeld(leg.entry, leg.exit, `transfer-out:${leg.id}`),
        ),
      );

    const exit = leg.exit ?? {};
    const hub = exit.hub?.trim() || (exit.mode === 'train' ? 'the station' : 'the airport');
    out.push(
      groundNeed(
        `transfer-out:${leg.id}`,
        `Getting from ${name} to ${hub}`,
        // Where an older version put this transfer's reference in the flight's
        // slot, read it as what it is rather than asking for it again.
        leg.id === last?.id && stray && !exit.transferRef ? { ...exit, transferRef: stray } : exit,
        // Before the two directions were told apart this was `transfer:<leg>`,
        // and the booking it recorded was the way out — so that is the one it
        // still settles.
        paid(expenses, `transfer-out:${leg.id}`, undefined, `transfer:${leg.id}`),
        {
          category: 'Transportation',
          subcategory: 'Airport Transfer (Abroad)',
          description: `Airport transfer — ${name}`,
          cityId: leg.id,
          asksTransport: true,
        },
        'transfer',
        undefined,
        coverageHeld(leg.exit, leg.entry, `transfer-in:${leg.id}`),
      ),
    );

    if (leg.sleep !== 'hotel') return;
    const hotelKey = `hotel:${leg.id}`;
    const hotelRow = paid(expenses, hotelKey);
    const base = leg.base?.name?.trim();
    const hotelRef = leg.base?.bookingRef?.trim();
    // A hotel named in the research is a choice, not a room held for you.
    const state: NeedState = hotelRow ? 'paid' : hotelRef ? 'booked' : base ? 'planned' : 'open';
    out.push({
      key: hotelKey,
      kind: 'hotel',
      label: `Somewhere to stay in ${name}`,
      detail: state === 'planned' ? `${base} — chosen, not booked` : base || 'No hotel yet',
      state,
      done: settles('hotel', state),
      evidence: hotelRow ? paymentWords(hotelRow) : hotelRef ? `Booking ${hotelRef}` : base,
      book: {
        category: 'Accommodation',
        subcategory: 'Hotel',
        description: `Hotel — ${name}`,
        cityId: leg.id,
        asksPlace: true,
      },
    });
  });

  // --- The itinerary, one city at a time for a multi-city trip ---
  const research = researchCities(legs);
  const names = research.map((c) => c.name);
  const plan = trip.planText ?? '';
  if (research.length > 1) {
    for (const c of research) {
      const block = cityBlock(plan, c.name, names);
      out.push({
        key: `plan:${c.id}`,
        kind: 'plan',
        label: `A plan for ${c.name}`,
        detail: block?.trim() ? 'Written' : 'Not researched yet',
        state: block?.trim() ? 'settled' : 'open',
        done: !!block?.trim(),
        href: `#/trip/${trip.id}/prompt`,
      });
    }
  } else {
    out.push({
      key: 'plan',
      kind: 'plan',
      label: 'An itinerary',
      detail: plan.trim() ? 'Written' : 'Not researched yet',
      state: plan.trim() ? 'settled' : 'open',
      done: !!plan.trim(),
      href: `#/trip/${trip.id}/prompt`,
    });
  }

  // --- What the plan itself says to book ahead ---
  for (const s of [...stops].sort((a, b) => a.order - b.order)) {
    const ahead = s.bookAhead?.trim();
    if (!ahead || s.visited) continue;
    const key = `book:${s.id}`;
    const row = paid(expenses, key);
    // A timed entry can be free, and the ledger only records what was paid —
    // so the reservation lives on the place it was made for.
    const ref = s.bookingRef?.trim();
    const state: NeedState = row ? 'paid' : ref || s.booked ? 'booked' : 'open';
    out.push({
      key,
      kind: 'book',
      label: `Book ${s.name} ahead`,
      detail: ahead,
      state,
      done: settles('book', state),
      evidence: row
        ? paymentWords(row)
        : ref
          ? `Booking ${ref}`
          : s.booked
            ? 'Reserved'
            : undefined,
      book: {
        category: 'Experiences',
        subcategory: 'Museum',
        description: s.name,
        cityId: s.cityId,
      },
    });
  }

  // --- Checking in, once the flight is close ---
  for (const d of tripDepartures(trip, legs)) {
    if (d.mode !== 'flight' || d.at < now || d.at - now > CHECKIN_WINDOW_MS) continue;
    out.push({
      key: `checkin:${d.key}`,
      kind: 'checkin',
      label: `Check in — ${d.from === 'home' ? 'flight out' : `flight from ${d.from}`}`,
      detail: d.plan.number ? `${d.plan.number}, ${d.wall.slice(11, 16)}` : d.wall.slice(11, 16),
      state: d.plan.checkedIn === true ? 'settled' : 'open',
      done: d.plan.checkedIn === true,
      evidence: d.plan.checkedIn ? 'Checked in' : undefined,
      departureKey: d.key,
    });
  }

  return out;
}

/**
 * What a stamped expense settles, in words, for a screen that has the row but
 * not the trip's needs: 'the ticket out', 'the ride to the airport'. So the
 * ledger can say which line of Before-you-go a row answers for, and what
 * deleting it would reopen.
 */
export function needWords(key: string | undefined): string {
  if (!key) return '';
  const [kind] = key.split(':');
  const back = key.endsWith(':back') || key.endsWith(':inbound');
  switch (kind) {
    case 'flight':
      return back ? 'the ticket home' : 'the ticket out';
    case 'transfer-uk':
      return back ? 'getting home from the airport' : 'getting to the airport';
    case 'transfer-in':
      return 'the way in from the airport';
    case 'transfer-out':
    case 'transfer':
      return 'the way to the airport';
    case 'hotel':
      return 'somewhere to stay';
    case 'book':
      return 'a place booked ahead';
    default:
      return '';
  }
}

/** The ones still outstanding — what the card leads with. */
export function outstanding(needs: Need[]): Need[] {
  return needs.filter((n) => !n.done);
}

/**
 * The trip has happened: every departure it knows about is behind us. A trip
 * can sit in Planning long after it is over, and asking someone to book a
 * flight they have already taken is worse than saying nothing.
 */
export function tripIsOver(trip: Trip, cities: City[], now = Date.now()): boolean {
  const deps = tripDepartures(trip, cities);
  return deps.length > 0 && deps.every((d) => d.at < now);
}

// ---- Booking one ----

export interface BookInput {
  /** What it came to, in sterling — the figure the ledger and the sheet keep. */
  amountGBP: number;
  /** What was actually charged, where that was not sterling. */
  amountLocal?: number;
  currency?: string;
  fxRate?: number | null;
  /** The £ was typed by hand, so no later rate may rewrite it. */
  gbpManual?: boolean;
  /** Saved with no £ yet: it prices itself from its own date's rate when online. */
  fxPending?: boolean;
  /** The clock times on a booked ride's ticket ('HH:MM'). */
  transferAt?: string;
  transferArr?: string;
  /** Bought on the day: knowing which ride it is settles it. */
  payOnDay?: boolean;
  /** Booking reference, where the thing booked has one. */
  ref?: string;
  /** How you get there, for a transfer. */
  transport?: string;
  journeyMin?: number;
  /** Where you are staying, for a hotel. */
  place?: string;
  /**
   * One ticket for the journey there and the journey back — a return bus into
   * town, a return coach to Stansted. Both journeys stay their own line (they
   * are two journeys), but the detail is written to both, so one purchase
   * settles both rather than leaving the other reading as unsorted.
   */
  bothWays?: boolean;
  /** The day it was paid for; today unless said otherwise. */
  date?: string;
  paymentMethod?: string;
}

/**
 * Record a booking once: the travel detail where it belongs, and the payment
 * in the ledger, stamped with the need it settles.
 *
 * A skeleton row already seeded for this need (or matching its description) is
 * filled in rather than joined by a second row, so booking the £22 coach
 * leaves exactly one expense — and the amount is never typed again.
 */
export async function bookNeed(
  trip: Trip,
  need: Need,
  input: BookInput,
): Promise<{ expenseId: string | null }> {
  return db.transaction('rw', db.trips, db.cities, db.stops, db.expenses, async () => {
    const current = await db.trips.get(trip.id);
    if (!current) throw new Error('This trip no longer exists.');
    trip = current;
    const legs = await db.cities.where('tripId').equals(trip.id).sortBy('order');
    const expenses = await db.expenses.where('tripId').equals(trip.id).toArray();
    const stops = await db.stops.where('tripId').equals(trip.id).toArray();
    const currentNeed = tripNeeds(trip, legs, expenses, stops).find((n) => n.key === need.key);
    if (!currentNeed?.book) throw new Error('This booking is no longer part of the trip.');
    need = currentNeed;
    const last = legs[legs.length - 1];
    const ref = input.ref?.trim();
    const place = input.place?.trim();
    // How you are getting there, for whichever journey this need is.
    const journey = {
      ...(input.transport?.trim() ? { transport: input.transport.trim() } : {}),
      ...(input.journeyMin != null ? { journeyMin: input.journeyMin } : {}),
      ...(input.transferAt?.trim() ? { transferAt: input.transferAt.trim() } : {}),
      ...(input.transferArr?.trim() ? { transferArr: input.transferArr.trim() } : {}),
      ...(input.payOnDay ? { payOnDay: true } : {}),
      ...(ref ? { transferRef: ref } : {}),
    };
    const something =
      Object.keys(journey).length > 0 || input.amountGBP > 0 || (input.amountLocal ?? 0) > 0;
    // The direction that does not hold the money is still held: a £9 return bus
    // ticket is a ticket for the way back too. Only once there is actually a
    // purchase or a reference, though — ticking the box over an empty form is
    // still just a plan.
    const held =
      input.bothWays && (ref || input.amountGBP > 0 || (input.amountLocal ?? 0) > 0)
        ? { coveredBy: need.key }
        : null;
    const merge = (plan?: DepartPlan, other = false) => {
      const next = { ...plan, ...(!other ? journey : {}), ...(other && held ? held : {}) };
      if (
        (!other && (ref || input.amountGBP > 0 || (input.amountLocal ?? 0) > 0)) ||
        (other && plan?.coveredBy === need.key && !held)
      )
        delete next.coveredBy;
      return next;
    };
    const legOf = (prefix: string) => legs.find((c) => c.id === need.key.slice(prefix.length));

    // --- The structured half: the reference goes on the thing it books ---
    if (need.key === 'flight:outbound' && ref)
      await db.trips.update(trip.id, {
        outbound: { ...trip.outbound, ref },
        updatedAt: Date.now(),
      });
    if (need.key === 'flight:inbound' && ref && last)
      await db.cities.update(last.id, { exit: { ...last.exit, ref } });
    const both = !!input.bothWays;
    if (need.kind === 'transfer-uk' && (something || held)) {
      const isOut = need.key === 'transfer-uk:out';
      await db.trips.update(trip.id, {
        ...(both || isOut || trip.outbound?.coveredBy === need.key
          ? { outbound: merge(trip.outbound, !isOut) }
          : {}),
        ...(both || !isOut || trip.homeward?.coveredBy === need.key
          ? { homeward: merge(trip.homeward, isOut) }
          : {}),
        updatedAt: Date.now(),
      });
    }
    if (need.kind === 'transfer' && (something || held)) {
      const inbound = need.key.startsWith('transfer-in:');
      const leg = legOf(inbound ? 'transfer-in:' : 'transfer-out:');
      if (leg)
        await db.cities.update(leg.id, {
          ...(both || inbound || leg.entry?.coveredBy === need.key
            ? { entry: merge(leg.entry, !inbound) }
            : {}),
          ...(both || !inbound || leg.exit?.coveredBy === need.key
            ? { exit: merge(leg.exit, inbound) }
            : {}),
        });
    }
    if (need.kind === 'hotel') {
      const leg = legOf('hotel:');
      if (leg && (place || ref))
        await db.cities.update(leg.id, {
          base: {
            ...leg.base,
            ...(place ? { name: place } : {}),
            ...(ref ? { bookingRef: ref } : {}),
          },
        });
    }
    if (need.kind === 'book') {
      const stopId = need.key.slice('book:'.length);
      await db.stops.update(stopId, { booked: true, ...(ref ? { bookingRef: ref } : {}) });
    }
    if (need.kind === 'flight' || need.kind === 'transfer') await recomputeTripDerived(trip.id);

    // --- The ledger half ---
    // Nothing paid, nothing to record. A charge in a currency with no rate yet
    // still counts: it has an amount, just not a £ one.
    if (!need.book || !(input.amountGBP > 0 || (input.amountLocal ?? 0) > 0))
      return { expenseId: null };
    const spec = need.book;
    const all = await db.expenses.where('tripId').equals(trip.id).toArray();
    // A return ticket says so in its description, the way the spending sheet has
    // always said it — so the insight that reads what one journey costs can halve
    // it, instead of counting a £24 return as £24 each way.
    const description =
      both && need.kind === 'transfer-uk' ? 'Airport transfer (UK) (Return)' : spec.description;
    const fields = {
      cityId: spec.cityId ?? null,
      date: input.date || todayIso(),
      destination: spec.shared
        ? sharedDestination(legs)
        : (legs.find((c) => c.id === spec.cityId)?.name ?? ''),
      category: spec.category,
      subcategory: spec.subcategory,
      description,
      paymentMethod: input.paymentMethod || lastPaymentMethod(all, trip.id) || 'Online Payment',
      amountGBP: input.amountGBP,
      amountLocal: input.amountLocal ?? 0,
      // The rate actually used goes in Notes, the way a row captured on the
      // ground records it — the exported sheet has no column for it.
      notes: withFxNote(
        ref ? `Booking ${ref}` : '',
        input.currency ?? 'GBP',
        input.gbpManual ? null : (input.fxRate ?? null),
      ),
      currency: input.currency?.trim().toUpperCase() || 'GBP',
      fxRate: input.fxRate ?? null,
      gbpManual: input.gbpManual ?? true,
      fxPending: input.fxPending ?? false,
      ...(spec.shared ? { shared: true } : {}),
      need: need.key,
      skeleton: false,
    };

    // Fill the placeholder that was already waiting for this, rather than
    // leaving it behind as a second row. A trip-wide need matches its own words
    // exactly, so booking the way home can never fill the way out; a leg's need
    // names a city the preset never knew, so it takes the first unfilled row of
    // the right kind instead.
    const perLeg = need.kind === 'hotel' || need.kind === 'transfer';
    const existing =
      all.find((e) => e.need === need.key) ??
      all.find(
        (e) =>
          e.skeleton &&
          !e.need &&
          e.subcategory === spec.subcategory &&
          (perLeg || e.description.trim().toLowerCase() === spec.description.trim().toLowerCase()),
      );
    if (existing) {
      await db.expenses.update(existing.id, fields);
      return { expenseId: existing.id };
    }
    const id = newId();
    await db.expenses.add({
      id,
      tripId: trip.id,
      ...fields,
      order: all.length,
      createdAt: Date.now(),
    });
    return { expenseId: id };
  });
}

/** Tick (or untick) checking in for one departure. */
export async function setCheckedIn(
  trip: Trip,
  departureKey: string,
  value: boolean,
): Promise<void> {
  if (departureKey === 'outbound') {
    await db.trips.update(trip.id, {
      outbound: { ...trip.outbound, checkedIn: value },
      updatedAt: Date.now(),
    });
    return;
  }
  const leg = await db.cities.get(departureKey);
  if (leg) await db.cities.update(leg.id, { exit: { ...leg.exit, checkedIn: value } });
}

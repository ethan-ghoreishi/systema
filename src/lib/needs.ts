import { db, type City, type Expense, type Stop, type Trip } from './db';
import { cityBlock } from './headings';
import { newId } from './ids';
import { lastPaymentMethod, sharedDestination } from './expense-defaults';
import { researchCities } from './prompt';
import { tripDepartures } from './readiness';
import { recomputeTripDerived } from './trips';
import { todayIso } from './sheet';

/**
 * "Before you go": what is still unresolved, worked out from the trip rather
 * than kept as a list to tick.
 *
 * Nothing here is a task. Each need names a thing that has to exist before
 * departure, and it is done when that thing exists: a booking reference on the
 * flight, a transport mode on the departure, a hotel on the leg, a plan for the
 * city, a payment in the ledger. So a 25-item checklist shrinks to the few
 * things actually outstanding, and the list empties itself as the trip comes
 * together — nothing to mark off, nothing to go stale.
 *
 * The one exception is checking in: the window differs by airline and leaves
 * no trace in the data, so it is a plain tick (DepartPlan.checkedIn), and it
 * only appears once the flight is close.
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

const paid = (expenses: Expense[], key: string): Expense | undefined =>
  expenses.find((e) => !e.skeleton && e.need === key && e.amountGBP > 0);

const gbp = (n: number) => `£${Number.isInteger(n) ? n : n.toFixed(2)}`;

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

  // --- The two tickets ---
  const outRef = ob.ref?.trim();
  const outPaid = paid(expenses, 'flight:outbound');
  out.push({
    key: 'flight:outbound',
    kind: 'flight',
    label: 'Ticket out',
    detail: [ob.hub, ob.number].filter(Boolean).join(' ') || 'Leaving London',
    done: !!outRef || !!outPaid,
    evidence: outRef ? `Booking ${outRef}` : outPaid ? gbp(outPaid.amountGBP) : undefined,
    book: {
      category: 'Transportation',
      subcategory: 'Flight',
      description: 'Outbound flight',
      shared: true,
      cityId: null,
    },
  });

  const inRef = last?.exit?.ref?.trim();
  const inPaid = paid(expenses, 'flight:inbound');
  out.push({
    key: 'flight:inbound',
    kind: 'flight',
    label: 'Ticket home',
    detail:
      [last?.exit?.hub, last?.exit?.number].filter(Boolean).join(' ') ||
      (last ? `Leaving ${last.name}` : 'The flight home'),
    done: !!inRef || !!inPaid,
    evidence: inRef ? `Booking ${inRef}` : inPaid ? gbp(inPaid.amountGBP) : undefined,
    book: {
      category: 'Transportation',
      subcategory: 'Flight',
      description: 'Inbound flight',
      shared: true,
      cityId: null,
    },
  });

  // --- The London end, both ways ---
  const ukOut = paid(expenses, 'transfer-uk:out');
  out.push({
    key: 'transfer-uk:out',
    kind: 'transfer-uk',
    label: `Getting to ${ob.hub || 'the airport'}`,
    detail: ob.transport?.trim()
      ? `${ob.transport.trim()}${ob.journeyMin ? `, ${ob.journeyMin} min` : ''}`
      : 'Not chosen yet',
    done: !!ob.transport?.trim() || !!ukOut,
    evidence: ukOut ? gbp(ukOut.amountGBP) : ob.transport?.trim() || undefined,
    book: {
      category: 'Transportation',
      subcategory: 'Airport Transfer (UK)',
      description: 'Airport transfer (UK) — outbound',
      shared: true,
      cityId: null,
      asksTransport: true,
    },
  });

  const ukBack = paid(expenses, 'transfer-uk:back');
  out.push({
    key: 'transfer-uk:back',
    kind: 'transfer-uk',
    label: 'Getting home from the airport',
    detail: ukBack ? 'Booked' : 'Not booked yet',
    done: !!ukBack,
    evidence: ukBack ? gbp(ukBack.amountGBP) : undefined,
    book: {
      category: 'Transportation',
      subcategory: 'Airport Transfer (UK)',
      description: 'Airport transfer (UK) — return',
      shared: true,
      cityId: null,
    },
  });

  // --- Each city: the transfer, and a bed where one is needed ---
  for (const leg of legs) {
    const exit = leg.exit ?? {};
    const key = `transfer:${leg.id}`;
    const row = paid(expenses, key);
    const known = !!exit.transport?.trim() || exit.journeyMin != null;
    out.push({
      key,
      kind: 'transfer',
      label: `Airport transfer in ${leg.name || 'the next city'}`,
      detail: known
        ? `${exit.transport?.trim() || 'Planned'}${exit.journeyMin != null ? `, ${exit.journeyMin} min` : ''}`
        : 'How you get in and out is not noted',
      done: known || !!row,
      evidence: row ? gbp(row.amountGBP) : exit.transport?.trim() || undefined,
      book: {
        category: 'Transportation',
        subcategory: 'Airport Transfer (Abroad)',
        description: `Airport transfer — ${leg.name || 'city'}`,
        cityId: leg.id,
        asksTransport: true,
      },
    });

    if (leg.sleep !== 'hotel') continue;
    const hotelKey = `hotel:${leg.id}`;
    const hotelRow = paid(expenses, hotelKey);
    const base = leg.base?.name?.trim();
    out.push({
      key: hotelKey,
      kind: 'hotel',
      label: `Somewhere to stay in ${leg.name || 'the city'}`,
      detail: base || 'No hotel yet',
      done: !!base || !!hotelRow,
      evidence: hotelRow ? gbp(hotelRow.amountGBP) : base,
      book: {
        category: 'Accommodation',
        subcategory: 'Hotel',
        description: `Hotel — ${leg.name || 'city'}`,
        cityId: leg.id,
        asksPlace: true,
      },
    });
  }

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
    out.push({
      key,
      kind: 'book',
      label: `Book ${s.name} ahead`,
      detail: ahead,
      done: !!row,
      evidence: row ? gbp(row.amountGBP) : undefined,
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
      done: d.plan.checkedIn === true,
      evidence: d.plan.checkedIn ? 'Checked in' : undefined,
      departureKey: d.key,
    });
  }

  return out;
}

/** The ones still outstanding — what the card leads with. */
export function outstanding(needs: Need[]): Need[] {
  return needs.filter((n) => !n.done);
}

// ---- Booking one ----

export interface BookInput {
  amountGBP: number;
  /** Booking reference, where the thing booked has one. */
  ref?: string;
  /** How you get there, for a transfer. */
  transport?: string;
  journeyMin?: number;
  /** Where you are staying, for a hotel. */
  place?: string;
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
  const legs = await db.cities.where('tripId').equals(trip.id).sortBy('order');
  const last = legs[legs.length - 1];
  const ref = input.ref?.trim();
  const transport = input.transport?.trim();
  const place = input.place?.trim();

  // --- The structured half ---
  if (need.key === 'flight:outbound' && ref) {
    await db.trips.update(trip.id, {
      outbound: { ...trip.outbound, ...(ref ? { ref } : {}) },
      updatedAt: Date.now(),
    });
  }
  if (need.key === 'flight:inbound' && ref && last) {
    await db.cities.update(last.id, { exit: { ...last.exit, ref } });
  }
  if (need.key === 'transfer-uk:out' && (transport || input.journeyMin != null)) {
    await db.trips.update(trip.id, {
      outbound: {
        ...trip.outbound,
        ...(transport ? { transport } : {}),
        ...(input.journeyMin != null ? { journeyMin: input.journeyMin } : {}),
      },
      updatedAt: Date.now(),
    });
  }
  if (need.kind === 'transfer') {
    const leg = legs.find((c) => c.id === need.key.slice('transfer:'.length));
    if (leg && (transport || input.journeyMin != null || ref))
      await db.cities.update(leg.id, {
        exit: {
          ...leg.exit,
          ...(transport ? { transport } : {}),
          ...(input.journeyMin != null ? { journeyMin: input.journeyMin } : {}),
          ...(ref ? { ref } : {}),
        },
      });
  }
  if (need.kind === 'hotel') {
    const leg = legs.find((c) => c.id === need.key.slice('hotel:'.length));
    if (leg && place) await db.cities.update(leg.id, { base: { ...leg.base, name: place } });
  }
  if (need.kind === 'flight' || need.kind === 'transfer') await recomputeTripDerived(trip.id);

  // --- The ledger half ---
  if (!need.book || !(input.amountGBP > 0)) return { expenseId: null };
  const spec = need.book;
  const all = await db.expenses.where('tripId').equals(trip.id).toArray();
  const fields = {
    cityId: spec.cityId ?? null,
    date: input.date || todayIso(),
    destination: spec.shared
      ? sharedDestination(legs)
      : (legs.find((c) => c.id === spec.cityId)?.name ?? ''),
    category: spec.category,
    subcategory: spec.subcategory,
    description: spec.description,
    paymentMethod: input.paymentMethod || lastPaymentMethod(all, trip.id) || 'Online Payment',
    amountGBP: input.amountGBP,
    amountLocal: 0,
    notes: ref ? `Booking ${ref}` : '',
    currency: 'GBP',
    fxRate: null,
    gbpManual: true,
    ...(spec.shared ? { shared: true } : {}),
    need: need.key,
    skeleton: false,
  };

  const existing =
    all.find((e) => e.need === need.key) ??
    all.find(
      (e) =>
        e.skeleton &&
        e.subcategory === spec.subcategory &&
        e.description.trim().toLowerCase() === spec.description.trim().toLowerCase(),
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

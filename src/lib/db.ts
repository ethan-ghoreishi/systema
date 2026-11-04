import Dexie, { type Table } from 'dexie';

/**
 * The single local-first data store. IndexedDB is the source of truth on the
 * device; everything else (the capture sheet, Claude, FX) is downstream.
 *
 * Lean by design: Trip → City → Stop / Expense / Moment, plus a key/value
 * table for settings and a photos table for image blobs.
 */

export type TripType = 'same-day' | 'airport-sleep' | 'weekend' | 'custom';
export type TripStatus = 'planning' | 'active' | 'done';

/** Where the traveller slept during a leg: nowhere, dozed at the airport, or a hotel. */
export type SleepKind = 'none' | 'airport' | 'hotel';

/**
 * How a trip card picks its cover image. 'auto' = a single city's route map →
 * photo → route card; a multi-city trip's auto cover is a photo → journey card.
 */
export type CoverMode = 'auto' | 'map' | 'route-card' | 'photo';

/**
 * How a place is left: the move to the next city or home. Every field is
 * optional; the readiness card fills sensible defaults and says when it does.
 * The departure time itself is the leg's `departure` (or `Trip.outbound.at`).
 */
export interface DepartPlan {
  /** 'flight' (default), 'train', 'bus', 'ferry' or 'other'. */
  mode?: string;
  /** Airport IATA code or station, e.g. 'BLQ'. */
  hub?: string;
  terminal?: string;
  /** Flight or train number. */
  number?: string;
  /** Booking reference for the service itself (the flight, the train). */
  ref?: string;
  /**
   * Booking reference for the journey *to* the hub — the coach, the transfer.
   * Its own key, because `ref` is the flight's: one reference must never be
   * read as the other (a booked coach is not a booked flight).
   */
  transferRef?: string;
  notes?: string;
  /** Where the journey to the hub starts (defaults to the leg's base). */
  from?: string;
  /** How you get to the hub, e.g. 'Marconi Express', 'taxi', 'walk'. */
  transport?: string;
  journeyMin?: number;
  /**
   * The clock time the ride to the hub actually leaves ('HH:MM', the
   * departure's own zone) — a booked coach has one, and it does not wait. When
   * it is known, leave-by counts back from it instead of from an assumed
   * journey length, and says so (see readiness.ts).
   */
  transferAt?: string;
  /** And when it gets there, where the ticket says so. */
  transferArr?: string;
  /**
   * You buy this ride at the machine or the gate: knowing which ride it is
   * settles it, and no booking is coming. Without it, a mode and a time are
   * only a plan — which is not the same as being sorted (see needs.ts).
   */
  payOnDay?: boolean;
  /**
   * The need key of a purchase that already covers this journey — a return
   * ticket bought for the other direction. The two stay separate journeys
   * (different hours, sometimes different stops), but one of them holds the
   * money and this one is held all the same.
   */
  coveredBy?: string;
  /** How long before departure to be at the hub. */
  bufferMin?: number;
  /** Slack on top, for the unexpected. */
  contingencyMin?: number;
  /** How long before leave-by to start getting ready. */
  prepareMin?: number;
  /**
   * Two-city stopover: this hop is a protected connection on the ticket from
   * London ('outbound') or the ticket home ('return').
   */
  throughTicket?: 'outbound' | 'return';
  /**
   * Checked in for this flight. The one thing before a trip that nothing else
   * can tell us: the airline's window differs and leaves no trace in the data.
   */
  checkedIn?: boolean;
}

/** Where you stay in a city. */
export interface LegBase {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  checkIn?: string; // 'YYYY-MM-DDTHH:mm', the city's local time
  checkOut?: string;
  /** Booking reference: a place named is a choice, a reference is a booking. */
  bookingRef?: string;
}

/** The departure from home, before the first leg. */
export interface OutboundPlan extends DepartPlan {
  at?: string; // 'YYYY-MM-DDTHH:mm' in `tz`
  tz?: string; // default Europe/London
}

/** A visit's mindful anchor: where to begin, the smallest worthwhile visit, what to look for. */
export interface StopGuide {
  anchor?: string;
  minimum?: string;
  lookFor?: string[];
  stretch?: string;
  exit?: string;
}

/** Saved answers for the research prompt builder (per trip). */
export interface PromptPrefs {
  /** 'plan' = design a new route; 'have-plan' = enrich an itinerary I already have. */
  mode: 'plan' | 'have-plan';
  pace: string;
  budget: string;
  companions: string;
  interests: string[];
  museumsMax: number;
  hotel: string;
  constraints: string;
  pastVisits: string;
  notes: string;
  /** @deprecated Superseded by the derived itinerary; kept so old saved prefs still parse. */
  destination?: string;
  arrival?: string;
  departure?: string;
  durationLabel?: string;
}

export interface Trip {
  id: string;
  /**
   * Display name is normally derived from the legs (see tripDisplayName);
   * `name` is a fallback for older/imported trips. `nameManual` is an explicit
   * user override that wins over the derived name.
   */
  name: string;
  nameManual?: string;
  type: TripType;
  startDate: string; // 'YYYY-MM-DD' or '' — fallback; legs derive it when present
  endDate: string; // 'YYYY-MM-DD' or '' — fallback; legs derive it when present
  partySize: number; // default 2
  returnFlightAt: string; // 'YYYY-MM-DDTHH:mm' or '' — fallback countdown target
  accommodation: boolean;
  status: TripStatus;
  planText: string; // the pasted itinerary (Markdown)
  /** Post-trip journal pasted back from Claude (optional; shown on the Plan tab). */
  journalText?: string;
  /** Saved research-prompt-builder answers (optional). */
  promptPrefs?: PromptPrefs;
  /**
   * The Opportunity this trip was chosen from. The link lives here, not on the
   * Opportunity, so "chosen" is derived and nothing has to be kept in step —
   * and so an opportunity row never carries a `tripId` for a restore to
   * mistake for a record moving between trips.
   */
  opportunityId?: string;
  /** Which of that opportunity's options was chosen, so the record of the decision keeps. */
  optionId?: string;
  /** How the trip card picks its cover (default 'auto'). */
  coverMode?: CoverMode;
  /** Chosen photo id when coverMode === 'photo'. */
  coverPhotoId?: string;
  /**
   * Starting-point key when it isn't `type` (e.g. 'two-city'). `type` keeps
   * one of the original values so devices on older versions still sync.
   */
  preset?: string;
  /** Leaving home for the first leg. */
  outbound?: OutboundPlan;
  /**
   * Getting home from the airport at the end — the other half of the London
   * end, and a journey of its own: a late landing is not the morning coach out.
   * Its `at` is when the flight home lands, which is what decides whether you
   * get in at a civilised hour (and so what the fridge needs).
   */
  homeward?: OutboundPlan;
  /**
   * Ticked personal preparation, anything added by hand, the lines put aside
   * as not applying, and which section an added line belongs in (see prep.ts).
   * `extra` stays a plain list of lines: a device on an older version reads it
   * as one, and would show an object as text.
   */
  prep?: {
    done?: string[];
    extra?: string[];
    skipped?: string[];
    groups?: Record<string, string>;
  };
  order: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * A leg of the trip: one city visit, in walking/travel order. Arrival and
 * departure are optional (older/imported trips have none) — when present they
 * drive the trip's dates, countdown, and derived shape. `sleep` records where
 * the night(s) around this leg were spent.
 */
export interface City {
  id: string;
  tripId: string;
  name: string;
  currency: string; // ISO 4217, e.g. 'EUR'
  order: number;
  arrival?: string; // 'YYYY-MM-DDTHH:mm', wall-clock time in `tz`
  departure?: string; // 'YYYY-MM-DDTHH:mm', wall-clock time in `tz`
  sleep?: SleepKind;
  /** IANA time zone the leg's times are in. Unset (older legs): this device's zone. */
  tz?: string;
  /** Hotel or base. */
  base?: LegBase;
  /**
   * Getting from the arrival airport (or station) into the city. A distinct
   * journey from `exit`: a different direction, usually a different time of
   * day and often a different mode, so it is booked and priced on its own.
   * Carries no flight — the flight that lands is the previous leg's `exit`.
   */
  entry?: DepartPlan;
  /** How this city is left (the departure at `departure`). */
  exit?: DepartPlan;
  /** Last write (ms). Set automatically; absent on records from older versions. */
  updatedAt?: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Stop {
  id: string;
  tripId: string;
  cityId: string | null;
  name: string;
  notes: string; // free text — where lens content (system reading, contrasts) is pasted
  checklist: ChecklistItem[];
  visited: boolean;
  /** Optional map position (imported from the plan or placed by hand). */
  lat?: number;
  lng?: number;
  /** Structured visit anchor, extracted from the plan or written by hand. */
  guide?: StopGuide;
  /**
   * What has to be booked before arriving, from the plan's `Book ahead:` line
   * (a timed-entry museum, say). Logistics, not an anchor, so it sits beside
   * the guide rather than inside it.
   */
  bookAhead?: string;
  /**
   * Reserved. Some bookings cost nothing — a timed entry, a free slot — so the
   * ledger cannot answer for them: only what was paid goes in there. The
   * reservation itself lives on the place it was made for.
   */
  booked?: boolean;
  bookingRef?: string;
  /** When it was ticked visited (ms); absent on stops ticked by older versions. */
  visitedAt?: number;
  /**
   * The zone its times are read in, kept here only when the leg that held it
   * is deleted — otherwise the leg's `tz` answers, and a correction there
   * still reaches this stop.
   */
  tz?: string;
  /**
   * The name of that deleted leg, kept for the same reason: so the record
   * reads as the Rome stop it is, not as one of the legs that remain.
   */
  legName?: string;
  order: number;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Something that happened off the plan: a place found by accident, a changed
 * plan, a missed bus, an encounter. Optionally linked to a planned stop.
 */
export interface Moment {
  id: string;
  tripId: string;
  cityId: string | null;
  title: string;
  note: string;
  /** When it happened (ms). */
  at: number;
  stopId: string | null;
  /** The zone `at` is read in, kept only when its leg is deleted (see Stop.tz). */
  tz?: string;
  /** The name of that deleted leg, kept for the same reason (see Stop.legName). */
  legName?: string;
  /**
   * Where it happened, when it is a place of its own. A moment linked to a
   * stop shows at that stop's pin instead and carries none.
   */
  lat?: number;
  lng?: number;
  createdAt: number;
  updatedAt?: number;
}

/**
 * One realistic way to make a trip: a pair of dates, a pair of airports and
 * what the tickets cost — read from a Cheap-Trip Finder row, or typed.
 *
 * Fares and times go stale, so an option is disposable: it belongs to its
 * Opportunity and dies with it. Nothing else ever points at one, which is why
 * options live in a list on the Opportunity rather than in a table of their own.
 *
 * The finder's own figures (`finderPP`, `usableH`, `groundH`) are kept exactly
 * as it worked them out and never recalculated here — Systema only re-prices
 * them against what the ledger knows (see options.ts).
 */
export interface TripOption {
  id: string;
  /** 'YYYY-MM-DD' — the day you leave London, and the day you come back. */
  outDate: string;
  backDate: string;
  /** Airports in order: ['STN', 'NTE'], or ['TNG', 'BCN', 'LHR'] through a stopover. */
  outRoute: string[];
  backRoute: string[];
  /** 'HH:MM', local to each end. */
  outDep?: string;
  outArr?: string;
  backDep?: string;
  backArr?: string;
  /** Days the arrival falls after its date (a '+1' landing after midnight). */
  outArrDay?: number;
  backArrDay?: number;
  /** 'Ryanair 2232', or 'Vueling 8515 + Vueling 7642' through a stopover. */
  outFlights?: string;
  backFlights?: string;
  /**
   * Fares as quoted, £ per person — always sterling, because that is what the
   * comparison, the ranking and the finder's own figures are in.
   */
  outFarePP?: number;
  backFarePP?: number;
  /**
   * The fare as it is actually sold, where that is not sterling: two tickets
   * bought separately are often priced in two different currencies, and a
   * dinar read as a pound is a tenfold error. The £ above is the conversion;
   * these keep what was really quoted, so the figure can be checked.
   */
  outFareLocal?: number;
  outFareCcy?: string;
  backFareLocal?: number;
  backFareCcy?: string;
  /** The finder's true cost per person, its usable daylight and ground hours. */
  finderPP?: number;
  usableH?: number;
  groundH?: number;
  /** 'NTE 21h', or 'TNG 10h + BCN* 8h' (`*` = a protected layover city). */
  cities?: string;
  /** 'Hotel ×1', 'Airport sleep (~5h50)', '4 · back via BCN, night at the destination'. */
  overnight?: string;
  paidNights?: number;
  /** Two-city stopover scenario 1–4, when the row is one (see trip-shape.ts). */
  scenario?: number;
  /** When the fare was last checked ('YYYY-MM-DD HH:mm'): a fortnight-old fare is a guess. */
  checked?: string;
  /** Google Flights searches, so a fare can be re-checked in one tap. */
  outLink?: string;
  backLink?: string;
  note?: string;
  /**
   * Written by hand rather than read from a finder row. A manual option has no
   * `finderPP`, so its total is added up from its own parts instead (see
   * options.ts) — the fares stated plus what the ledger has measured.
   */
  source?: 'manual';
  /**
   * The cost assumptions the search this row came from actually ran with,
   * read from its `.config.json`. Kept per option so a re-priced figure is
   * measured against that run rather than against constants mirrored here,
   * which drift the moment the finder's defaults change.
   */
  finderAssumptions?: {
    travellers?: number;
    destTransferPP?: number;
    hotelPerNight?: number;
    bagStoragePerDay?: number;
    esimPerTrip?: number;
    earlyDepPenalty?: number;
  };
}

/**
 * A destination taken seriously enough to compare — the durable half of the
 * decision. Its research outlives every option: when a date window loses, what
 * was learned about the city is still true, so nothing has to be collected
 * twice. Nothing has to be tidied either: an opportunity with no live options
 * and no trip reads as past on its own (see opportunities.ts).
 */
export interface Opportunity {
  id: string;
  /** The destination, as the finder names it. */
  city: string;
  country?: string;
  /** Durable knowledge about the place: transfers, closures, what to book. */
  research?: string;
  options: TripOption[];
  createdAt: number;
  updatedAt?: number;
}

export type PhotoKind = 'stop' | 'receipt' | 'cover';

export interface Photo {
  id: string;
  tripId: string;
  stopId: string | null; // set for kind === 'stop'
  expenseId: string | null; // set for kind === 'receipt'
  /** Set for a moment's photo (kind 'stop', so older versions still accept it). */
  momentId?: string | null;
  kind: PhotoKind;
  blob: Blob;
  /** Uploaded to the NAS by sync. Deleting a photo removes it on every device (tombstone). */
  backedUp?: boolean;
  /** When it was taken (ms), from the camera's metadata where available. */
  takenAt?: number;
  /** Size and SHA-256 of the image bytes, for verifying the NAS copy. */
  bytes?: number;
  sha256?: string;
  createdAt: number;
}

export interface Expense {
  id: string;
  tripId: string;
  cityId: string | null;
  // Master-sheet columns (Transaction# and Subtotal are derived at CSV-export
  // time, not stored: Transaction# is the row's 1-based position within the
  // trip, and Subtotal is a separate per-trip total row).
  date: string;
  destination: string;
  category: string;
  subcategory: string;
  description: string;
  paymentMethod: string;
  amountGBP: number;
  amountLocal: number;
  notes: string;
  // Local-only metadata (not written verbatim to the sheet):
  currency: string;
  fxRate: number | null;
  /** Saved without a GBP value; auto-priced from the ECB rate when online. */
  fxPending?: boolean;
  /** ECB date of the rate in `fxRate` (rate provenance). */
  fxDate?: string;
  /** The GBP amount was typed in by hand: never re-priced. */
  gbpManual?: boolean;
  /**
   * Trip-wide (flights, a hotel booked for both cities): not one city's spend.
   * Unset on older rows; a 'CityA/CityB' destination then reads as shared.
   */
  shared?: boolean;
  /**
   * The thing that had to be sorted before the trip and this payment settles
   * ('flight:outbound', 'transfer-uk:back', 'hotel:<legId>'…). Booking writes
   * the amount and the travel details in one go, so £22 is never typed twice.
   * See needs.ts. Absent on rows captured on the ground; empty after an explicit
   * reclassification, so legacy description matching cannot reattach it.
   */
  need?: string;
  /**
   * What this was quoted at when the trip was chosen — the fare off the
   * option, for the whole party. Deliberately not `amountGBP`: the ledger
   * records what was paid, and a quote in that column would be a purchase the
   * totals, the insights and the sheet all believed in. It rides along so
   * "Book it" can offer the figure instead of asking for it again, and it
   * stays after payment as what the trip was expected to cost.
   */
  quote?: { amountGBP: number; note?: string };
  skeleton: boolean; // pre-seeded placeholder row vs. a real entry
  order: number;
  createdAt: number;
  updatedAt?: number;
}

export interface FxRate {
  code: string; // ISO 4217 of the local currency
  rate: number; // multiply a local amount by this to get GBP
  date: string; // 'YYYY-MM-DD' the rate is for (ECB date)
  fetchedAt: number;
}

export interface KeyValue {
  key: string;
  value: unknown;
}

export class SystemaDB extends Dexie {
  kv!: Table<KeyValue, string>;
  trips!: Table<Trip, string>;
  cities!: Table<City, string>;
  stops!: Table<Stop, string>;
  expenses!: Table<Expense, string>;
  photos!: Table<Photo, string>;
  fxRates!: Table<FxRate, string>;
  moments!: Table<Moment, string>;
  opportunities!: Table<Opportunity, string>;

  constructor() {
    super('systema');

    // v1 — Phase 0: settings only.
    this.version(1).stores({ kv: 'key' });

    // v2 — Phase 1: the trip data model. Existing installs migrate cleanly.
    this.version(2).stores({
      kv: 'key',
      trips: 'id, order, status, updatedAt',
      cities: 'id, tripId, order',
      stops: 'id, tripId, cityId, order',
      expenses: 'id, tripId, cityId, transactionNo, order',
      photos: 'id, tripId, stopId, expenseId, kind',
    });

    // v3 — Phase 2: cached FX rates (keyed by currency code).
    this.version(3).stores({
      kv: 'key',
      trips: 'id, order, status, updatedAt',
      cities: 'id, tripId, order',
      stops: 'id, tripId, cityId, order',
      expenses: 'id, tripId, cityId, order',
      photos: 'id, tripId, stopId, expenseId, kind',
      fxRates: 'code',
    });

    // v4 — off-plan moments. Every other new field is optional and unindexed,
    // so existing rows need no rewrite: absent values derive at read time.
    this.version(4).stores({
      kv: 'key',
      trips: 'id, order, status, updatedAt',
      cities: 'id, tripId, order',
      stops: 'id, tripId, cityId, order',
      expenses: 'id, tripId, cityId, order',
      photos: 'id, tripId, stopId, expenseId, kind, momentId',
      fxRates: 'code',
      moments: 'id, tripId, cityId, stopId',
    });

    // v5 — opportunities (a destination being compared, with its options).
    // Another additive step: a new table and optional fields only, so an
    // install on v4 upgrades without rewriting a row, and a device still on v4
    // keeps syncing (a snapshot without the table deletes nothing).
    this.version(5).stores({
      kv: 'key',
      trips: 'id, order, status, updatedAt',
      cities: 'id, tripId, order',
      stops: 'id, tripId, cityId, order',
      expenses: 'id, tripId, cityId, order',
      photos: 'id, tripId, stopId, expenseId, kind, momentId',
      fxRates: 'code',
      moments: 'id, tripId, cityId, stopId',
      opportunities: 'id, city',
    });
  }
}

export const db = new SystemaDB();

// Every user record carries `updatedAt`, so sync can tell which of two
// conflicting edits is newer. Set on every write unless the writer (e.g. a
// sync merge) supplies its own.
for (const table of [
  db.trips,
  db.cities,
  db.stops,
  db.expenses,
  db.moments,
  db.opportunities,
] as Table<{
  updatedAt?: number;
}>[]) {
  table.hook('creating', (_key, obj) => {
    obj.updatedAt ??= Date.now();
  });
  table.hook('updating', (mods) =>
    'updatedAt' in (mods as object) ? undefined : { updatedAt: Date.now() },
  );
}

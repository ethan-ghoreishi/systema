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
  /** Booking reference. */
  ref?: string;
  notes?: string;
  /** Where the journey to the hub starts (defaults to the leg's base). */
  from?: string;
  /** How you get to the hub, e.g. 'Marconi Express', 'taxi', 'walk'. */
  transport?: string;
  journeyMin?: number;
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
}

/** Where you stay in a city. */
export interface LegBase {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  checkIn?: string; // 'YYYY-MM-DDTHH:mm', the city's local time
  checkOut?: string;
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
  /** When it was ticked visited (ms); absent on stops ticked by older versions. */
  visitedAt?: number;
  /**
   * The zone its times are read in, kept here only when the leg that held it
   * is deleted — otherwise the leg's `tz` answers, and a correction there
   * still reaches this stop.
   */
  tz?: string;
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
  /**
   * Where it happened, when it is a place of its own. A moment linked to a
   * stop shows at that stop's pin instead and carries none.
   */
  lat?: number;
  lng?: number;
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
  }
}

export const db = new SystemaDB();

// Every user record carries `updatedAt`, so sync can tell which of two
// conflicting edits is newer. Set on every write unless the writer (e.g. a
// sync merge) supplies its own.
for (const table of [db.trips, db.cities, db.stops, db.expenses, db.moments] as Table<{
  updatedAt?: number;
}>[]) {
  table.hook('creating', (_key, obj) => {
    obj.updatedAt ??= Date.now();
  });
  table.hook('updating', (mods) =>
    'updatedAt' in (mods as object) ? undefined : { updatedAt: Date.now() },
  );
}

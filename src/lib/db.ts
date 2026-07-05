import Dexie, { type Table } from 'dexie';

/**
 * The single local-first data store. IndexedDB is the source of truth on the
 * device; everything else (the capture sheet, Claude, FX) is downstream.
 *
 * Lean by design: Trip → City → Stop / Expense, plus a key/value table for
 * settings and a photos table for image blobs.
 */

export type TripType = 'same-day' | 'airport-sleep' | 'weekend' | 'custom';
export type TripStatus = 'planning' | 'active' | 'done';

/** Where the traveller slept during a leg: nowhere, dozed at the airport, or a hotel. */
export type SleepKind = 'none' | 'airport' | 'hotel';

/** How a trip card picks its cover image. 'auto' = route map → photo → route card. */
export type CoverMode = 'auto' | 'map' | 'route-card' | 'photo';

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
  arrival?: string; // 'YYYY-MM-DDTHH:mm'
  departure?: string; // 'YYYY-MM-DDTHH:mm'
  sleep?: SleepKind;
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
  order: number;
  createdAt: number;
}

export type PhotoKind = 'stop' | 'receipt' | 'cover';

export interface Photo {
  id: string;
  tripId: string;
  stopId: string | null; // set for kind === 'stop'
  expenseId: string | null; // set for kind === 'receipt'
  kind: PhotoKind;
  blob: Blob;
  /** Pushed to the NAS backup vault (safe to delete locally to free space). */
  backedUp?: boolean;
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
  skeleton: boolean; // pre-seeded placeholder row vs. a real entry
  order: number;
  createdAt: number;
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
  }
}

export const db = new SystemaDB();

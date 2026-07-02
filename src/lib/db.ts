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

/** Saved answers for the research prompt builder (all optional, per trip). */
export interface PromptPrefs {
  destination: string;
  arrival: string; // free text, e.g. "20 June 2026, 8:40am"
  departure: string;
  durationLabel: string; // e.g. 'one-day' | 'two-day' | 'three-day'
  pace: string;
  budget: string;
  companions: string;
  interests: string[];
  museumsMax: number;
  hotel: string;
  constraints: string;
  pastVisits: string;
  notes: string;
}

export interface Trip {
  id: string;
  name: string;
  type: TripType;
  startDate: string; // 'YYYY-MM-DD' or ''
  endDate: string; // 'YYYY-MM-DD' or ''
  partySize: number; // default 2
  returnFlightAt: string; // 'YYYY-MM-DDTHH:mm' or '' — drives the departure countdown
  accommodation: boolean;
  status: TripStatus;
  planText: string; // the pasted itinerary (Markdown)
  /** Post-trip journal pasted back from Claude (optional; shown on the Plan tab). */
  journalText?: string;
  /** Saved research-prompt-builder answers (optional). */
  promptPrefs?: PromptPrefs;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface City {
  id: string;
  tripId: string;
  name: string;
  currency: string; // ISO 4217, e.g. 'EUR'
  order: number;
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
  order: number;
  createdAt: number;
}

export type PhotoKind = 'stop' | 'receipt';

export interface Photo {
  id: string;
  tripId: string;
  stopId: string | null; // set for kind === 'stop'
  expenseId: string | null; // set for kind === 'receipt'
  kind: PhotoKind;
  blob: Blob;
  createdAt: number;
}

export interface Expense {
  id: string;
  tripId: string;
  cityId: string | null;
  // Sheet columns (Transaction# and Subtotal are derived at sync time, not stored:
  // Transaction# is the row's 1-based position within the trip, and Subtotal is a
  // separate per-trip total row).
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
  synced: boolean;
  /** Transaction# recorded at sync time, so sheet numbering stays stable. */
  syncedNo?: number;
  /** Edited locally after it was sent — the sheet row needs a manual amend. */
  editedAfterSync?: boolean;
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

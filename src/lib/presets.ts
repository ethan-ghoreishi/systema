import type { Trip, TripType } from './db';

/**
 * Trip starting points. Plain data, not a configurable engine — a preset just
 * seeds the usual expense rows and a sensible accommodation default at creation
 * time. The trip's actual shape, dates and name are derived from its legs
 * afterwards (see trip-shape.ts), so the preset never constrains the trip.
 */

export interface SkeletonRow {
  category: string;
  subcategory: string;
  description: string;
}

export interface TripPreset {
  /** Unique key; equals `type` for the original presets. */
  key: string;
  /** Stored on the trip: one of the original values, so older versions still sync. */
  type: TripType;
  label: string;
  blurb: string;
  accommodation: boolean;
  skeleton: SkeletonRow[];
}

// The flight + transfer spine shared by all travel presets.
const travelSpine: SkeletonRow[] = [
  { category: 'Transportation', subcategory: 'Flight', description: 'Outbound flight' },
  { category: 'Transportation', subcategory: 'Flight', description: 'Inbound flight' },
  {
    category: 'Transportation',
    subcategory: 'Airport Transfer (UK)',
    description: 'Airport transfer (UK) — outbound',
  },
  {
    category: 'Transportation',
    subcategory: 'Airport Transfer (UK)',
    description: 'Airport transfer (UK) — return',
  },
  {
    category: 'Transportation',
    subcategory: 'Airport Transfer (Abroad)',
    description: 'Airport transfer (abroad) — arrival',
  },
  {
    category: 'Transportation',
    subcategory: 'Airport Transfer (Abroad)',
    description: 'Airport transfer (abroad) — departure',
  },
  {
    category: 'Personal & Financial Expenses',
    subcategory: 'Other Personal Items',
    description: 'eSIM',
  },
  { category: 'Food', subcategory: 'Snacks', description: 'Airport water' },
];

export const tripPresets: TripPreset[] = [
  {
    key: 'same-day',
    type: 'same-day',
    label: 'Day trip',
    blurb: 'Out and back the same day, no hotel. Seeds the flight and transfer rows.',
    accommodation: false,
    skeleton: travelSpine,
  },
  {
    key: 'airport-sleep',
    type: 'airport-sleep',
    label: 'Airport sleep',
    blurb: 'Land late, doze at the airport, no hotel. Also seeds a bag-storage row.',
    accommodation: false,
    skeleton: [
      ...travelSpine,
      {
        category: 'Personal & Financial Expenses',
        subcategory: 'Other Personal Items',
        description: 'Bag storage',
      },
    ],
  },
  {
    key: 'weekend',
    type: 'weekend',
    label: 'City break',
    blurb: 'One or more hotel nights. Also seeds a hotel row.',
    accommodation: true,
    skeleton: [
      ...travelSpine,
      { category: 'Accommodation', subcategory: 'Hotel', description: 'Hotel' },
    ],
  },
  {
    key: 'two-city',
    type: 'weekend',
    label: 'Two-City Stopover',
    blurb:
      'Two cities in two days on one protected ticket: land by ~11:00, move on that evening or next morning, home after ~18:00, one hotel night.',
    accommodation: true,
    skeleton: [
      { category: 'Transportation', subcategory: 'Flight', description: 'Outbound flight' },
      { category: 'Transportation', subcategory: 'Flight', description: 'Inbound flight' },
      {
        category: 'Transportation',
        subcategory: 'Airport Transfer (UK)',
        description: 'Airport transfer (UK) — outbound',
      },
      {
        category: 'Transportation',
        subcategory: 'Airport Transfer (UK)',
        description: 'Airport transfer (UK) — return',
      },
      {
        category: 'Transportation',
        subcategory: 'Airport Transfer (Abroad)',
        description: 'Airport transfer — first city, arrival',
      },
      {
        category: 'Transportation',
        subcategory: 'Airport Transfer (Abroad)',
        description: 'Airport transfer — first city, to the hop',
      },
      {
        category: 'Transportation',
        subcategory: 'Airport Transfer (Abroad)',
        description: 'Airport transfer — second city, arrival',
      },
      {
        category: 'Transportation',
        subcategory: 'Airport Transfer (Abroad)',
        description: 'Airport transfer — second city, departure',
      },
      { category: 'Accommodation', subcategory: 'Hotel', description: 'Hotel (one night)' },
      {
        category: 'Personal & Financial Expenses',
        subcategory: 'Other Personal Items',
        description: 'eSIM',
      },
      { category: 'Food', subcategory: 'Snacks', description: 'Airport water' },
    ],
  },
  {
    key: 'custom',
    type: 'custom',
    label: 'Custom',
    blurb: 'Start blank and add your own expense rows.',
    accommodation: false,
    skeleton: [],
  },
];

export function presetByKey(key: string): TripPreset {
  return tripPresets.find((p) => p.key === key) ?? tripPresets[tripPresets.length - 1];
}

/** The starting point a trip was created from. */
export function presetFor(trip: Pick<Trip, 'type' | 'preset'>): TripPreset {
  return presetByKey(trip.preset ?? trip.type);
}

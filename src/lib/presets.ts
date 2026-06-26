import type { TripType } from './db';

/**
 * Trip-type presets. Plain data, not a configurable engine — they just set
 * sensible defaults at trip-creation time. The skeleton rows are seeded into
 * Expenses (Phase 2) so only the variable items need adding by hand.
 */

export interface SkeletonRow {
  category: string;
  subcategory: string;
  description: string;
}

export interface TripPreset {
  type: TripType;
  label: string;
  blurb: string;
  accommodation: boolean;
  countdown: boolean;
  allowExtraCity: boolean;
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
    type: 'same-day',
    label: 'Extreme Same-Day',
    blurb: 'Out at dawn, home for bed. Direct both ways, 6+ hours in the city. No accommodation.',
    accommodation: false,
    countdown: true,
    allowExtraCity: false,
    skeleton: travelSpine,
  },
  {
    type: 'airport-sleep',
    label: 'Airport Sleep',
    blurb: 'Land late, doze at the airport, explore all day, fly back in the evening.',
    accommodation: false,
    countdown: true,
    allowExtraCity: true,
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
    type: 'weekend',
    label: 'Weekend Getaway',
    blurb: 'A proper mini-break with one or more hotel nights.',
    accommodation: true,
    countdown: true,
    allowExtraCity: true,
    skeleton: [
      ...travelSpine,
      { category: 'Accommodation', subcategory: 'Hotel', description: 'Hotel' },
    ],
  },
  {
    type: 'custom',
    label: 'Custom',
    blurb: 'Set accommodation on or off and add your own skeleton rows.',
    accommodation: false,
    countdown: true,
    allowExtraCity: true,
    skeleton: [],
  },
];

export function presetByType(type: TripType): TripPreset {
  return tripPresets.find((p) => p.type === type) ?? tripPresets[tripPresets.length - 1];
}

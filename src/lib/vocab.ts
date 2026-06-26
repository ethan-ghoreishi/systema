/**
 * Controlled vocabularies for expenses — used exactly as tap-chips, in this
 * order. Mirrors the Travel Spending sheet.
 */

export const categories = [
  'Transportation',
  'Accommodation',
  'Experiences',
  'Food',
  'Personal & Financial Expenses',
] as const;

export type Category = (typeof categories)[number];

export const subcategories: Record<string, string[]> = {
  Transportation: [
    'Flight',
    'Airport Transfer (UK)',
    'Airport Transfer (Abroad)',
    'Local Transport (UK)',
    'Local Transport (Abroad)',
    'Regional Train (Abroad)',
    'Regional Bus (Abroad)',
    'Ferry / Boat',
    'Lift / Funicular',
  ],
  Accommodation: [
    'Hotel',
    'Hostel',
    'Guesthouse / B&B',
    'Apartment / Short-let (Airbnb, Vrbo)',
    'Resort',
    'Other Accommodation',
  ],
  Experiences: [
    'Museum',
    'Landmark',
    'Palace',
    'Tomb',
    'Cathedral',
    'Historic Site',
    'Performance / Event',
  ],
  Food: ['Grocery Shopping', 'Café', 'Snacks', 'Restaurant / Hot Food'],
  'Personal & Financial Expenses': [
    'ATM Fee',
    'Gift / Souvenirs',
    'Toiletries / Medicine',
    'Other Personal Items',
  ],
};

export const paymentMethods = ['Online Payment', 'Card Payment', 'Cash Payment'] as const;

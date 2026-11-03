/**
 * Currencies, for the places this app is actually used in: the city a leg is
 * priced in, and the currency a fare was sold in.
 *
 * A short, ordered list beats free text on a phone — an empty box with a
 * suggestion list behind it is a box iOS shows as empty, which is how a leg
 * ended up with no currency at all. Anything missing can still be typed.
 */

export interface CurrencyOption {
  code: string;
  name: string;
}

export const commonCurrencies: CurrencyOption[] = [
  { code: 'GBP', name: 'Pound sterling' },
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US dollar' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'ISK', name: 'Icelandic króna' },
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'CZK', name: 'Czech koruna' },
  { code: 'HUF', name: 'Hungarian forint' },
  { code: 'RON', name: 'Romanian leu' },
  { code: 'BGN', name: 'Bulgarian lev' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'ALL', name: 'Albanian lek' },
  { code: 'MKD', name: 'Macedonian denar' },
  { code: 'RSD', name: 'Serbian dinar' },
  { code: 'GEL', name: 'Georgian lari' },
  { code: 'AMD', name: 'Armenian dram' },
  { code: 'AZN', name: 'Azerbaijani manat' },
  { code: 'JOD', name: 'Jordanian dinar' },
  { code: 'ILS', name: 'Israeli shekel' },
  { code: 'EGP', name: 'Egyptian pound' },
  { code: 'MAD', name: 'Moroccan dirham' },
  { code: 'TND', name: 'Tunisian dinar' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'QAR', name: 'Qatari riyal' },
  { code: 'SAR', name: 'Saudi riyal' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'ZAR', name: 'South African rand' },
];

/** The ones a fare is realistically sold in, for the fare picker. */
export const FARE_CURRENCIES = [
  'GBP',
  'EUR',
  'USD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'TRY',
  'JOD',
  'ILS',
  'MAD',
  'AED',
  'JPY',
];

// Where the finder sends you, with the currency you spend there. Not a world
// table: the point is that choosing Amman does not then ask what Jordan uses.
const COUNTRY_CURRENCY: Record<string, string> = {
  albania: 'ALL',
  armenia: 'AMD',
  austria: 'EUR',
  azerbaijan: 'AZN',
  belgium: 'EUR',
  bulgaria: 'BGN',
  croatia: 'EUR',
  cyprus: 'EUR',
  'czech republic': 'CZK',
  czechia: 'CZK',
  denmark: 'DKK',
  egypt: 'EGP',
  estonia: 'EUR',
  finland: 'EUR',
  france: 'EUR',
  georgia: 'GEL',
  germany: 'EUR',
  greece: 'EUR',
  hungary: 'HUF',
  iceland: 'ISK',
  ireland: 'EUR',
  israel: 'ILS',
  italy: 'EUR',
  japan: 'JPY',
  jordan: 'JOD',
  latvia: 'EUR',
  lithuania: 'EUR',
  luxembourg: 'EUR',
  malta: 'EUR',
  moldova: 'MDL',
  montenegro: 'EUR',
  morocco: 'MAD',
  netherlands: 'EUR',
  'north macedonia': 'MKD',
  norway: 'NOK',
  poland: 'PLN',
  portugal: 'EUR',
  qatar: 'QAR',
  romania: 'RON',
  'saudi arabia': 'SAR',
  serbia: 'RSD',
  slovakia: 'EUR',
  slovenia: 'EUR',
  spain: 'EUR',
  sweden: 'SEK',
  switzerland: 'CHF',
  tunisia: 'TND',
  turkey: 'TRY',
  türkiye: 'TRY',
  'united arab emirates': 'AED',
  uae: 'AED',
  'united kingdom': 'GBP',
  uk: 'GBP',
  'united states': 'USD',
  usa: 'USD',
};

/** What you spend in this country, where the answer is not in doubt. */
export function currencyForCountry(country: string | undefined): string {
  return COUNTRY_CURRENCY[(country ?? '').trim().toLowerCase()] ?? '';
}

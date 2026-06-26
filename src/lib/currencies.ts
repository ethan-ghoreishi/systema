/**
 * A short list of common currencies for the city currency picker (datalist).
 * Free text is still allowed — this is just an autosuggest convenience.
 */

export interface CurrencyOption {
  code: string;
  name: string;
}

export const commonCurrencies: CurrencyOption[] = [
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'Pound sterling' },
  { code: 'USD', name: 'US dollar' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'CZK', name: 'Czech koruna' },
  { code: 'HUF', name: 'Hungarian forint' },
  { code: 'RON', name: 'Romanian leu' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'ISK', name: 'Icelandic króna' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'MAD', name: 'Moroccan dirham' },
  { code: 'AED', name: 'UAE dirham' },
];

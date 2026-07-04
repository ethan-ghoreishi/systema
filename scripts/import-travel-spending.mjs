#!/usr/bin/env node
/**
 * One-off importer: Travel Spending sheet -> systema backup JSON.
 *
 * Input: a Markdown-table dump of the master workbook (as produced by a Drive
 * export). Finds the Travel Spending table by its header row, groups rows into
 * trips (Transaction# restarts at 1; a subtotal-only row closes a trip), and
 * emits a systema backup file that the app imports via Export -> Import backup.
 *
 * Produces per trip:
 *  - Trip (status 'done', named "City (Mon YYYY)")
 *  - Cities (from Destination, currency inferred from local amounts)
 *  - Expenses (already reconciled in the master sheet before the app existed)
 *  - visited Stops inferred from Experiences rows (journal scaffolding)
 *
 * Usage: node scripts/import-travel-spending.mjs <dump.md> <out.json>
 * No personal data lives in this script; keep generated JSON out of the repo.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node scripts/import-travel-spending.mjs <dump.md> <out.json>');
  process.exit(1);
}

const unescapeMd = (s) => s.replace(/\\([\\#&\-!().])/g, '$1').trim();

/** '£1,234.56' -> 1234.56 */
function parseGBP(cell) {
  const m = cell.replace(/,/g, '').match(/-?£?\s*(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

// Symbol/abbreviation -> ISO code, matched case-insensitively on whatever is
// left of the cell once the number is removed. 'kr' defaults to SEK (the only
// krona country in this ledger so far).
const SYMBOL_CCY = {
  '€': 'EUR',
  $: 'USD',
  '¥': 'JPY',
  '₺': 'TRY',
  zł: 'PLN',
  kč: 'CZK',
  ft: 'HUF',
  lei: 'RON',
  kr: 'SEK',
};

/** '240 Kč' / '€9.00' / '1200 AMD' / '4800 ft' -> { amount, currency }. */
function parseLocal(cell) {
  const raw = unescapeMd(cell);
  if (!raw) return { amount: 0, currency: '' };
  const num = raw.replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)/);
  if (!num) return { amount: 0, currency: '' };
  const amount = Number(num[1]);

  const code = raw.match(/\b([A-Z]{3})\b/);
  if (code && code[1] !== 'GBP') return { amount, currency: code[1] };

  const rest = raw
    .replace(/[\d.,\s]/g, '')
    .trim()
    .toLowerCase();
  for (const [sym, ccy] of Object.entries(SYMBOL_CCY)) {
    if (rest === sym.toLowerCase() || rest.includes(sym.toLowerCase())) {
      return { amount, currency: ccy };
    }
  }
  return { amount, currency: '' };
}

/** 'DD/MM/YYYY' -> 'YYYY-MM-DD' */
function toIso(d) {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function monthLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** 'Belvedere Museum Entry' -> 'Belvedere Museum' */
function stopNameFromDescription(desc) {
  return desc
    .replace(/\s*\((return|one[- ]way)\)\s*$/i, '')
    .replace(/\s+(entry|entries|entrance|ticket|tickets|visit|tour|pass)\s*$/i, '')
    .trim();
}

// ---- read + locate the Travel Spending table ----
const text = readFileSync(inPath, 'utf8');
const lines = text.split(/\r?\n/);

const headerIdx = lines.findIndex(
  (l) => /\|\s*Date\s*\|/.test(l) && /Transaction/.test(l) && /Destination/.test(l),
);
if (headerIdx === -1) {
  console.error('Travel Spending header row not found');
  process.exit(1);
}

const cellsOf = (line) => {
  const parts = line.split('|').map((c) => c.trim());
  return parts.slice(1, -1); // drop the empty outer splits
};

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

// ---- group rows into trips ----
const trips = []; // { rows: [...], subtotal: number|null }
let current = null;

for (let i = headerIdx + 2; i < lines.length; i += 1) {
  const line = lines[i];
  if (!line.startsWith('|')) break; // end of table
  const c = cellsOf(line);
  if (c.length < 11) break;

  const [date, txn, dest, cat, sub, desc, pay, gbp, local, notes, subtotal] = c;

  if (DATE_RE.test(date)) {
    // A subtotal row is the authoritative trip boundary. Transaction# restarting
    // at 1 only opens a new trip if the destination changed too (numbering
    // sometimes restarts per day within one trip).
    const destName = unescapeMd(dest);
    const lastDest = current?.rows[current.rows.length - 1]?.destination;
    if (!current || (Number(txn) === 1 && lastDest !== destName)) {
      current = { rows: [], subtotal: null };
      trips.push(current);
    }
    current.rows.push({
      date: toIso(date),
      txn: Number(txn) || current.rows.length + 1,
      destination: unescapeMd(dest),
      category: unescapeMd(cat),
      subcategory: unescapeMd(sub),
      description: unescapeMd(desc),
      paymentMethod: unescapeMd(pay),
      amountGBP: parseGBP(gbp),
      local: parseLocal(local),
      notes: unescapeMd(notes),
    });
  } else if (current && subtotal && parseGBP(subtotal) > 0 && !date && !dest) {
    current.subtotal = parseGBP(subtotal);
    current = null; // subtotal row closes the trip
  }
}

// ---- build the backup ----
const outTrips = [];
const outCities = [];
const outStops = [];
const outExpenses = [];
const now = Date.now();
let warnings = 0;

trips.forEach((t, ti) => {
  if (t.rows.length === 0) return;
  const first = t.rows[0];
  const tripId = randomUUID();
  const name = `${first.destination} (${monthLabel(first.date)})`;

  const cityNames = first.destination
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  // Per-city default currency: the |cities| most frequent local currencies
  // (drops one-off oddities like an eSIM charged in AUD), ordered by first
  // appearance — outbound city spending precedes the second city's.
  const freq = {};
  const firstSeen = {};
  t.rows.forEach((r, idx) => {
    const c = r.local.currency;
    if (!c) return;
    freq[c] = (freq[c] ?? 0) + 1;
    if (!(c in firstSeen)) firstSeen[c] = idx;
  });
  const ranked = Object.keys(freq)
    .sort((a, b) => freq[b] - freq[a])
    .slice(0, Math.max(1, cityNames.length))
    .sort((a, b) => firstSeen[a] - firstSeen[b]);
  cityNames.forEach((cityName, ci) => {
    outCities.push({
      id: randomUUID(),
      tripId,
      name: cityName,
      currency: ranked[ci] ?? ranked[0] ?? '',
      order: ci,
    });
  });

  const total = t.rows.reduce((s, r) => s + r.amountGBP, 0);
  if (t.subtotal != null && Math.abs(total - t.subtotal) > 0.02) {
    console.warn(
      `warn: ${name}: rows sum £${total.toFixed(2)} != sheet subtotal £${t.subtotal.toFixed(2)}`,
    );
    warnings += 1;
  }

  outTrips.push({
    id: tripId,
    name,
    type: 'custom',
    startDate: first.date,
    endDate: t.rows[t.rows.length - 1].date,
    partySize: 2,
    returnFlightAt: '',
    accommodation: t.rows.some((r) => r.category === 'Accommodation'),
    status: 'done',
    planText: '',
    order: -(trips.length - ti), // history sorts below current trips, newest first
    createdAt: now,
    updatedAt: now,
  });

  let stopOrder = 0;
  const stopSeen = new Set();
  t.rows.forEach((r, ri) => {
    outExpenses.push({
      id: randomUUID(),
      tripId,
      cityId: null,
      date: r.date,
      destination: r.destination,
      category: r.category,
      subcategory: r.subcategory,
      description: r.description,
      paymentMethod: r.paymentMethod,
      amountGBP: Math.round((r.amountGBP + Number.EPSILON) * 100) / 100,
      amountLocal: r.local.amount,
      notes: r.notes,
      currency: r.local.currency || (r.local.amount ? '' : 'GBP'),
      fxRate: null,
      skeleton: false,
      order: ri,
      createdAt: now,
    });

    if (r.category === 'Experiences') {
      const stopName = stopNameFromDescription(r.description);
      const key = stopName.toLowerCase();
      if (stopName && !stopSeen.has(key)) {
        stopSeen.add(key);
        outStops.push({
          id: randomUUID(),
          tripId,
          cityId: null,
          name: stopName,
          notes: '',
          checklist: [],
          visited: true,
          order: stopOrder++,
          createdAt: now,
        });
      }
    }
  });
});

const backup = {
  app: 'systema',
  version: 1,
  exportedAt: new Date().toISOString(),
  trips: outTrips,
  cities: outCities,
  stops: outStops,
  expenses: outExpenses,
  fxRates: [],
  settings: [], // never clobber device settings
  photos: [],
};

writeFileSync(outPath, JSON.stringify(backup, null, 1));

const grand = outExpenses.reduce((s, e) => s + e.amountGBP, 0);
console.log(
  `trips: ${outTrips.length}, expenses: ${outExpenses.length}, stops: ${outStops.length}, ` +
    `cities: ${outCities.length}, grand total £${grand.toFixed(2)}, subtotal warnings: ${warnings}`,
);
console.log(outTrips.map((t) => `  ${t.name} (${t.startDate})`).join('\n'));

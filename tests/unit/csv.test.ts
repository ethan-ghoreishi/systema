import { describe, it, expect } from 'vitest';
import { buildTripCsv, buildAllTripsCsv, csvNote } from '../../src/lib/csv';
import { buildOverview } from '../../src/lib/insights';
import type { Expense, Trip } from '../../src/lib/db';

let seq = 0;
function exp(over: Partial<Expense>): Expense {
  seq += 1;
  return {
    id: `e${seq}`,
    tripId: 't1',
    cityId: null,
    date: '2024-10-08',
    destination: 'Vienna',
    category: 'Food',
    subcategory: 'Snacks',
    description: 'Water',
    paymentMethod: 'Card Payment',
    amountGBP: 2,
    amountLocal: 2.3,
    notes: '',
    currency: 'EUR',
    fxRate: null,
    skeleton: false,
    order: seq,
    createdAt: 0,
    ...over,
  };
}

function trip(over: Partial<Trip>): Trip {
  return {
    id: 't1',
    name: 'Vienna (Oct 2024)',
    type: 'custom',
    startDate: '2024-10-08',
    endDate: '2024-10-08',
    partySize: 2,
    returnFlightAt: '',
    accommodation: false,
    status: 'done',
    planText: '',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('buildTripCsv', () => {
  it('emits the 11 sheet columns, rows, and a closing subtotal row', () => {
    seq = 0;
    const csv = buildTripCsv([
      exp({ amountGBP: 10, description: 'Museum, entry' }),
      exp({ amountGBP: 5 }),
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'Date,Transaction#,Destination,Category,Subcategory,Description,Payment Method,Amount (GBP),Amount (Local),Notes,Subtotal',
    );
    // Comma-containing cells are quoted.
    expect(lines[1]).toContain('"Museum, entry"');
    expect(lines[1]).toContain('08/10/2024');
    // Subtotal row: blanks then the total.
    expect(lines[3]).toBe(',,,,,,,,,,15');
  });

  it('excludes rate-pending rows', () => {
    seq = 0;
    const csv = buildTripCsv([exp({ fxPending: true }), exp({ amountGBP: 3 })]);
    expect(csv.trim().split('\n')).toHaveLength(3); // header + 1 row + subtotal
  });
});

describe('buildAllTripsCsv', () => {
  it('orders trips chronologically with one subtotal each', () => {
    seq = 0;
    const t1 = trip({ id: 't1', startDate: '2025-01-01' });
    const t2 = trip({ id: 't2', name: 'Prague', startDate: '2024-01-01' });
    const csv = buildAllTripsCsv(
      [t1, t2],
      [exp({ tripId: 't1', destination: 'Vienna' }), exp({ tripId: 't2', destination: 'Prague' })],
    );
    const lines = csv.trim().split('\n');
    expect(lines[1]).toContain('Prague'); // older trip first
    expect(lines[3]).toContain('Vienna');
    expect(lines.filter((l) => l.startsWith(',,,,,,,,,,')).length).toBe(2);
  });
});

describe('buildOverview', () => {
  it('aggregates totals, categories and per-trip summaries', () => {
    seq = 0;
    const t1 = trip({ id: 't1', startDate: '2025-01-01' });
    const t2 = trip({ id: 't2', name: 'Prague', startDate: '2024-01-01' });
    const o = buildOverview(
      [t1, t2],
      [
        exp({ tripId: 't1', amountGBP: 10, category: 'Food' }),
        exp({ tripId: 't1', amountGBP: 35, category: 'Transportation' }),
        exp({ tripId: 't2', amountGBP: 20, category: 'Food' }),
      ],
    );
    expect(o.total).toBe(65);
    expect(o.tripCount).toBe(2);
    expect(o.average).toBe(32.5);
    expect(o.trips[0].trip.id).toBe('t1'); // newest first
    expect(o.trips[0].total).toBe(45);
    expect(o.byCategory[0]).toEqual({ category: 'Transportation', total: 35 });
    expect(o.maxTripTotal).toBe(45);
  });
});

it('discloses expenses left out of the CSV while awaiting a rate', () => {
  const rows = [exp({}), exp({ fxPending: true, amountGBP: 0 }), exp({ skeleton: true })];
  expect(buildTripCsv(rows).trim().split('\n')).toHaveLength(3); // header, 1 row, subtotal
  expect(csvNote(rows)).toContain('1 expense(s) awaiting an exchange rate were left out');
  expect(csvNote([exp({})])).toBe('');
});

/** RFC 4180 reader, enough to read our own export back. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  return rows;
}

describe('CSV round trip', () => {
  it('reads back exactly what was written, column for column', () => {
    const rows = [
      exp({
        description: 'Duomo, roof "terraces"',
        notes: 'line one\nline two',
        amountGBP: 12.5,
        amountLocal: 14.75,
      }),
      exp({
        description: 'Flights',
        destination: 'Bologna/Barcelona',
        shared: true,
        category: 'Transportation',
        subcategory: 'Flight',
        currency: 'GBP',
        amountGBP: 80,
        amountLocal: 0,
        fxDate: '2024-10-08',
        gbpManual: true,
      }),
    ];
    const parsed = parseCsv(buildTripCsv(rows));
    expect(parsed[0]).toHaveLength(11);
    expect(parsed[1]).toEqual([
      '08/10/2024',
      '1',
      'Vienna',
      'Food',
      'Snacks',
      'Duomo, roof "terraces"',
      'Card Payment',
      '12.5',
      '14.75 EUR',
      'line one\nline two',
      '',
    ]);
    // New fields never leak into the sheet's columns.
    expect(parsed[2]).toEqual([
      '08/10/2024',
      '2',
      'Bologna/Barcelona',
      'Transportation',
      'Flight',
      'Flights',
      'Card Payment',
      '80',
      '',
      '',
      '',
    ]);
    expect(parsed[3]).toEqual(['', '', '', '', '', '', '', '', '', '', '92.5']);
  });
});

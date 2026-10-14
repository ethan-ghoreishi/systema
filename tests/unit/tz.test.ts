import { describe, it, expect } from 'vitest';
import {
  instantToWall,
  isValidTz,
  suggestTz,
  timeIn,
  wallLabel,
  wallToInstant,
} from '../../src/lib/tz';

const Z = (s: string) => Date.parse(`${s}Z`);

describe('wallToInstant', () => {
  it('reads a ticket time in its own zone, whatever the device zone', () => {
    expect(wallToInstant('2026-06-20T08:40', 'Europe/Rome')).toBe(Z('2026-06-20T06:40'));
    expect(wallToInstant('2026-06-20T08:40', 'Europe/London')).toBe(Z('2026-06-20T07:40'));
    expect(wallToInstant('2026-06-20T08:40', 'Asia/Yerevan')).toBe(Z('2026-06-20T04:40'));
  });

  it('handles the autumn clock change (25 Oct 2026): a repeated hour takes the first', () => {
    // Rome: 03:00 CEST → 02:00 CET, so 02:30 happens twice.
    expect(wallToInstant('2026-10-25T02:30', 'Europe/Rome')).toBe(Z('2026-10-25T00:30'));
    expect(wallToInstant('2026-10-25T12:00', 'Europe/Rome')).toBe(Z('2026-10-25T11:00'));
    expect(wallToInstant('2026-10-24T12:00', 'Europe/Rome')).toBe(Z('2026-10-24T10:00'));
    expect(wallToInstant('2026-10-25T01:30', 'Europe/London')).toBe(Z('2026-10-25T00:30'));
  });

  it('resolves a time skipped by the spring clock change forward', () => {
    // Rome 29 Mar 2026: 02:00 CET → 03:00 CEST; 02:30 does not exist.
    expect(wallToInstant('2026-03-29T02:30', 'Europe/Rome')).toBe(Z('2026-03-29T01:30'));
    expect(instantToWall(Z('2026-03-29T01:30'), 'Europe/Rome')).toBe('2026-03-29T03:30');
  });

  it('a date alone is local midnight; junk is undefined', () => {
    expect(wallToInstant('2026-06-20', 'Europe/Rome')).toBe(Z('2026-06-19T22:00'));
    expect(wallToInstant('', 'Europe/Rome')).toBeUndefined();
    expect(wallToInstant('soon', 'Europe/Rome')).toBeUndefined();
  });

  it('an unknown or missing zone falls back to the device zone', () => {
    const local = new Date(2026, 5, 20, 8, 40).getTime();
    expect(wallToInstant('2026-06-20T08:40')).toBe(local);
    expect(wallToInstant('2026-06-20T08:40', 'Mars/Olympus')).toBe(local);
  });

  it('round-trips through instantToWall', () => {
    for (const tz of ['Europe/Lisbon', 'Europe/Rome', 'Africa/Cairo', 'Atlantic/Canary']) {
      const t = wallToInstant('2026-10-24T21:15', tz)!;
      expect(instantToWall(t, tz)).toBe('2026-10-24T21:15');
    }
  });
});

describe('labels', () => {
  it('formats a wall clock as written', () => {
    expect(wallLabel('2026-10-10T14:05')).toBe('Sat 10 Oct, 14:05');
    expect(wallLabel('2026-10-10')).toBe('Sat 10 Oct');
    expect(timeIn(Z('2026-06-20T06:40'), 'Europe/Rome')).toBe('08:40');
  });
});

describe('suggestTz', () => {
  it('suggests by city, by zone name, then by currency', () => {
    expect(suggestTz('Lisbon', 'EUR')).toBe('Europe/Lisbon');
    expect(suggestTz('Rome', 'EUR')).toBe('Europe/Rome');
    expect(suggestTz('Bologna', 'EUR')).toBe('Europe/Paris');
    expect(suggestTz('Larnaca', 'EUR')).toBe('Asia/Nicosia');
    expect(suggestTz('Yerevan', 'AMD')).toBe('Asia/Yerevan');
    expect(suggestTz('Somewhere', 'USD')).toBeUndefined();
    expect(isValidTz(suggestTz('Bologna', 'EUR'))).toBe(true);
  });
});

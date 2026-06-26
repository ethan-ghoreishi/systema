import { describe, it, expect } from 'vitest';
import { computeCountdown } from '../../src/lib/countdown';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('computeCountdown', () => {
  it('shows days/hours/minutes when far out', () => {
    const c = computeCountdown(2 * DAY + 3 * HOUR + 15 * MIN, 0);
    expect(c.expired).toBe(false);
    expect([c.days, c.hours, c.minutes]).toEqual([2, 3, 15]);
    expect(c.text).toBe('2d 3h 15m');
  });

  it('drops days when under a day', () => {
    expect(computeCountdown(5 * HOUR + 9 * MIN, 0).text).toBe('5h 9m');
  });

  it('shows minutes and seconds when under an hour', () => {
    expect(computeCountdown(9 * MIN + 5 * SEC, 0).text).toBe('9m 5s');
  });

  it('marks expired at or past the target', () => {
    expect(computeCountdown(0, 0).expired).toBe(true);
    expect(computeCountdown(0, 1000).expired).toBe(true);
    expect(computeCountdown(0, 5000).text).toBe('0m 0s');
  });
});

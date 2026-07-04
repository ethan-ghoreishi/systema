import { describe, it, expect } from 'vitest';
import { formatDateRange } from '../../src/lib/format';

describe('formatDateRange', () => {
  it('shows a placeholder when both dates are empty', () => {
    expect(formatDateRange('', '')).toBe('Dates TBC');
  });

  it('formats a single day when start equals end', () => {
    expect(formatDateRange('2024-06-04', '2024-06-04')).toBe('4 Jun');
  });

  it('formats a range with an en dash', () => {
    expect(formatDateRange('2024-06-04', '2024-06-06')).toBe('4 Jun – 6 Jun');
  });

  it('falls back to whichever date is present', () => {
    expect(formatDateRange('2024-06-04', '')).toBe('4 Jun');
  });
});

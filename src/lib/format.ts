/**
 * Small pure formatting/validation helpers. Pure on purpose so they're cheap
 * to unit-test.
 */

/** Format a single 'YYYY-MM-DD' as a short UK day, e.g. '4 Jun'. */
function formatDay(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Human-friendly date range for a trip card. */
export function formatDateRange(start: string, end: string): string {
  if (!start && !end) return 'Dates TBC';
  if (start && end && start !== end) return `${formatDay(start)} – ${formatDay(end)}`;
  return formatDay(start || end);
}

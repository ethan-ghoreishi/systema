/**
 * Small pure formatting/validation helpers. Pure on purpose so they're cheap
 * to unit-test.
 */

/** Trim a pasted web app URL. */
export function normaliseWebAppUrl(raw: string): string {
  return raw.trim();
}

/**
 * Loose sanity check that a URL looks like a Google Apps Script web app
 * `/exec` endpoint. Used only to warn the user — never to block.
 */
export function isLikelyAppsScriptUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      u.hostname.endsWith('script.google.com') &&
      u.pathname.includes('/exec')
    );
  } catch {
    return false;
  }
}

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

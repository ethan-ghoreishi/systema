/**
 * App settings model (pure — no runes), so the merge logic is unit-testable.
 * The only secrets ever stored are the capture web app URL and an optional
 * shared token. Nothing else.
 */

export interface Settings {
  /** Google Apps Script web app URL that appends expense rows. */
  webAppUrl: string;
  /** Optional shared token sent with each append (defence in depth). */
  sharedToken: string;
  /** NAS backup receiver URL (see docs/nas-backup-setup.md). */
  nasUrl: string;
  /** Token the NAS receiver expects. */
  nasToken: string;
}

export const defaultSettings: Settings = {
  webAppUrl: '',
  sharedToken: '',
  nasUrl: '',
  nasToken: '',
};

/**
 * Merge stored settings over the defaults. Tolerant of partial/older shapes so
 * the schema can grow without breaking existing installs.
 */
export function mergeSettings(base: Settings, stored: Partial<Settings>): Settings {
  return { ...base, ...stored };
}

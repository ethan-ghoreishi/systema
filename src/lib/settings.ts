/**
 * App settings model (pure — no runes), so the merge logic is unit-testable.
 * The only values stored are the NAS backup receiver URL and its token, on this
 * device. Nothing else.
 */

export interface Settings {
  /** NAS backup receiver URL (see docs/nas-backup-setup.md). */
  nasUrl: string;
  /** Token the NAS receiver expects. */
  nasToken: string;
}

export const defaultSettings: Settings = {
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

import { describe, it, expect } from 'vitest';
import { defaultSettings, mergeSettings } from '../../src/lib/settings';

describe('mergeSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(mergeSettings(defaultSettings, {})).toEqual(defaultSettings);
  });

  it('overrides the NAS receiver URL and token', () => {
    const merged = mergeSettings(defaultSettings, {
      nasUrl: 'https://nas.example.ts.net/systema-backup.php',
      nasToken: 'tok',
    });
    expect(merged.nasUrl).toBe('https://nas.example.ts.net/systema-backup.php');
    expect(merged.nasToken).toBe('tok');
  });

  it('does not mutate the base defaults', () => {
    mergeSettings(defaultSettings, { nasUrl: 'x' });
    expect(defaultSettings.nasUrl).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { defaultSettings, mergeSettings } from '../../src/lib/settings';

describe('mergeSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(mergeSettings(defaultSettings, {})).toEqual(defaultSettings);
  });

  it('overrides the web app URL and token', () => {
    const merged = mergeSettings(defaultSettings, {
      webAppUrl: 'https://script.google.com/macros/s/X/exec',
      sharedToken: 'tok',
    });
    expect(merged.webAppUrl).toBe('https://script.google.com/macros/s/X/exec');
    expect(merged.sharedToken).toBe('tok');
  });

  it('does not mutate the base defaults', () => {
    mergeSettings(defaultSettings, { webAppUrl: 'x' });
    expect(defaultSettings.webAppUrl).toBe('');
  });
});

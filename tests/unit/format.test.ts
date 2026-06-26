import { describe, it, expect } from 'vitest';
import { isLikelyAppsScriptUrl, normaliseWebAppUrl } from '../../src/lib/format';

describe('isLikelyAppsScriptUrl', () => {
  it('accepts a script.google.com /exec URL', () => {
    expect(isLikelyAppsScriptUrl('https://script.google.com/macros/s/ABC123/exec')).toBe(true);
  });

  it('rejects non-Apps-Script hosts', () => {
    expect(isLikelyAppsScriptUrl('https://example.com/macros/s/ABC/exec')).toBe(false);
  });

  it('rejects http (non-TLS)', () => {
    expect(isLikelyAppsScriptUrl('http://script.google.com/macros/s/ABC/exec')).toBe(false);
  });

  it('rejects garbage', () => {
    expect(isLikelyAppsScriptUrl('not a url')).toBe(false);
    expect(isLikelyAppsScriptUrl('')).toBe(false);
  });
});

describe('normaliseWebAppUrl', () => {
  it('trims surrounding whitespace', () => {
    expect(normaliseWebAppUrl('  https://x/exec  ')).toBe('https://x/exec');
  });
});

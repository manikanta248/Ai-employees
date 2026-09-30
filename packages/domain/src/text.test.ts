import { describe, expect, it } from 'vitest';
import { pickText } from './text';

describe('pickText', () => {
  const t = { en: 'Tea', hi: 'चाय' };
  it('returns the requested language when present', () => expect(pickText(t, 'hi')).toBe('चाय'));
  it('falls back to English when the translation is missing', () =>
    expect(pickText(t, 'te')).toBe('Tea'));
  it('falls back to English when the translation is blank', () => {
    expect(pickText({ en: 'Tea', te: '   ' }, 'te')).toBe('Tea');
  });
});

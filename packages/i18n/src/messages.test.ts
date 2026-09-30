import { describe, expect, it } from 'vitest';
import { LOCALES, flattenKeys, messages } from './index';

const enKeys = flattenKeys(messages.en).sort();

function leafValues(obj: Record<string, unknown>): string[] {
  return Object.values(obj).flatMap((v) =>
    typeof v === 'object' && v !== null ? leafValues(v as Record<string, unknown>) : [String(v)],
  );
}

describe('locale files', () => {
  it.each(LOCALES)('%s has exactly the same keys as English', (locale) => {
    expect(flattenKeys(messages[locale]).sort()).toEqual(enKeys);
  });

  it.each(LOCALES)('%s has no empty strings', (locale) => {
    for (const value of leafValues(messages[locale])) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it('Hindi contains Devanagari and Telugu contains Telugu script in every string', () => {
    // Guards against an English string being pasted into a translation file.
    // "Hazir" style loanwords are still written in the local script.
    for (const value of leafValues(messages.hi)) expect(value).toMatch(/[ऀ-ॿ]/);
    for (const value of leafValues(messages.te)) expect(value).toMatch(/[ఀ-౿]/);
  });

  it('keeps ICU-style placeholders identical across languages', () => {
    const placeholders = (s: string) => (s.match(/\{[^}]+\}/g) ?? []).sort();
    const flat = (l: (typeof LOCALES)[number]) =>
      Object.fromEntries(
        flattenKeys(messages[l]).map((k) => [
          k,
          k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], messages[l]),
        ]),
      ) as Record<string, string>;
    const en = flat('en');
    for (const l of ['hi', 'te'] as const) {
      const other = flat(l);
      for (const key of Object.keys(en)) {
        expect(placeholders(other[key]!)).toEqual(placeholders(en[key]!));
      }
    }
  });
});

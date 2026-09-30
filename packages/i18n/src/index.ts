import en from './messages/en.json';
import hi from './messages/hi.json';
import te from './messages/te.json';

export const LOCALES = ['en', 'hi', 'te'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Name of each language written in that language, for the language switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  hi: 'हिन्दी',
  te: 'తెలుగు',
};

export type Messages = typeof en;

export const messages: Record<Locale, Messages> = { en, hi, te };

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Flatten nested messages into dot-separated keys. Used by tests and tooling. */
export function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'object' && value !== null
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path];
  });
}

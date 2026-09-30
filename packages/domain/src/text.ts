export const LANGS = ['en', 'hi', 'te'] as const;
export type Lang = (typeof LANGS)[number];

/** Localised text as stored in the database. English is required and is the fallback. */
export type LocalizedText = { en: string } & Partial<Record<Exclude<Lang, 'en'>, string>>;

/** Pick text for a language, falling back to English when a translation is missing or blank. */
export function pickText(text: LocalizedText, lang: Lang): string {
  const wanted = text[lang];
  return wanted !== undefined && wanted.trim() !== '' ? wanted : text.en;
}

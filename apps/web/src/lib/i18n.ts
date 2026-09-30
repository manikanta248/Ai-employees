import { messages, type Locale } from '@hazir/i18n';

type Dict = Record<string, unknown>;

/** Returns a translator for one namespace, e.g. `const t = translator('en', 'designSheet')`. */
export function translator(locale: Locale, namespace: keyof (typeof messages)['en']) {
  const dict = messages[locale][namespace] as Dict;
  return (key: string): string => {
    const value = dict[key];
    if (typeof value !== 'string')
      throw new Error(`Missing message ${namespace}.${key} (${locale})`);
    return value;
  };
}

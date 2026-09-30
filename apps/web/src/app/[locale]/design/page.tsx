import { notFound } from 'next/navigation';
import { Badge, Button, Notice, TextField } from '@hazir/ui';
import { LOCALES, LOCALE_NAMES, isLocale } from '@hazir/i18n';
import { formatRupees, paise } from '@hazir/domain';
import { translator } from '@/lib/i18n';

export default async function DesignSheet({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ theme?: string }>;
}) {
  const { locale } = await params;
  const { theme } = await searchParams;
  if (!isLocale(locale)) notFound();
  const t = translator(locale, 'designSheet');
  const c = translator(locale, 'common');
  const themeAttr = theme === 'dark' || theme === 'light' ? theme : undefined;

  return (
    <div data-theme={themeAttr} style={{ minHeight: '100vh' }}>
      <main className="page">
        <header className="stack">
          <nav className="lang-nav" aria-label={c('language')}>
            {LOCALES.map((l) => (
              <a
                key={l}
                href={`/${l}/design${themeAttr ? `?theme=${themeAttr}` : ''}`}
                lang={l}
                hrefLang={l}
                aria-current={l === locale ? 'page' : undefined}
              >
                {LOCALE_NAMES[l]}
              </a>
            ))}
          </nav>
          <h1 style={{ fontSize: 'var(--text-3xl)' }}>{t('title')}</h1>
          <p>{t('intro')}</p>
        </header>

        <section className="stack" aria-labelledby="buttons">
          <h2 id="buttons" style={{ fontSize: 'var(--text-xl)' }}>
            {t('buttons')}
          </h2>
          <div className="row">
            <Button>{t('primary')}</Button>
            <Button variant="secondary">{t('secondary')}</Button>
            <Button disabled>{t('disabled')}</Button>
          </div>
          <div className="row">
            <Badge>{t('soldOut')}</Badge>
            <span>
              {t('price')}: <span className="price">{formatRupees(paise(12_050))}</span>
            </span>
          </div>
        </section>

        <section className="stack" aria-labelledby="fields">
          <h2 id="fields" style={{ fontSize: 'var(--text-xl)' }}>
            {t('fieldLabel')}
          </h2>
          <TextField label={t('fieldLabel')} help={t('fieldHelp')} />
          <TextField label={t('fieldLabel')} error={t('fieldError')} defaultValue="" />
        </section>

        <section className="stack" aria-labelledby="states">
          <h2 id="states" style={{ fontSize: 'var(--text-xl)' }}>
            {t('states')}
          </h2>
          <Notice tone="neutral">{t('empty')}</Notice>
          <Notice tone="error" action={<Button variant="secondary">{c('retry')}</Button>}>
            {t('error')}
          </Notice>
          <Notice tone="warning">{t('offline')}</Notice>
        </section>
      </main>
    </div>
  );
}

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { LOCALES, messages } from '../packages/i18n/src/index';

const themes = ['light', 'dark'] as const;

test('health endpoint reports ok and is never cached', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  expect((await res.json()).status).toBe('ok');
});

test('root redirects to the English component sheet', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/en\/design$/);
});

test('unknown language is a 404, not a broken page', async ({ page }) => {
  const res = await page.goto('/fr/design');
  expect(res?.status()).toBe(404);
});

test('security headers are present', async ({ request }) => {
  const res = await request.get('/en/design');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['x-frame-options']).toBe('DENY');
  expect(res.headers()['x-powered-by']).toBeUndefined();
});

for (const locale of LOCALES) {
  for (const theme of themes) {
    test.describe(`${locale} / ${theme}`, () => {
      const url = `/${locale}/design?theme=${theme}`;

      test('renders in the right language with real translated text', async ({ page }) => {
        await page.goto(url);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          messages[locale].designSheet.title,
        );
      });

      test('has no accessibility violations (WCAG 2.2 AA)', async ({ page }) => {
        await page.goto(url);
        await page.evaluate(() => document.fonts.ready);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(results.violations).toEqual([]);
      });

      test('has no horizontal scroll and every tap target is at least 44px', async ({ page }) => {
        await page.goto(url);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        const small = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('button, a[href], input')]
            .map((el) => ({
              tag: el.tagName,
              text: el.textContent?.trim(),
              h: el.getBoundingClientRect().height,
              w: el.getBoundingClientRect().width,
            }))
            .filter((r) => r.h < 44 || r.w < 44),
        );
        expect(small).toEqual([]);
      });

      test('matches the visual snapshot', async ({ page }) => {
        await page.goto(url);
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`sheet-${locale}-${theme}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.01,
          animations: 'disabled',
        });
      });
    });
  }
}

test('fonts for Hindi and Telugu are actually loaded (no fallback boxes)', async ({ page }) => {
  for (const [locale, family] of [
    ['hi', 'Noto Sans Devanagari Variable'],
    ['te', 'Noto Sans Telugu Variable'],
  ] as const) {
    await page.goto(`/${locale}/design`);
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(
      (f) =>
        [...document.fonts].some(
          (x) => x.family.replace(/['"]/g, '') === f && x.status === 'loaded',
        ),
      family,
    );
    expect(loaded, `${family} should be loaded for ${locale}`).toBe(true);
  }
});

test('reduced motion removes transitions', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/en/design');
  const dur = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--motion-fast').trim(),
  );
  expect(['0ms', '0s']).toContain(dur);
  await ctx.close();
});

test('keyboard focus is visible on interactive elements', async ({ page }) => {
  await page.goto('/en/design');
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { width: s.outlineWidth, style: s.outlineStyle };
  });
  expect(outline.style).not.toBe('none');
  expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
});

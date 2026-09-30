import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCss, dark, light, motion, tapTarget, type ColorScheme } from './tokens';
import { contrast } from './contrast';

const schemes: [string, ColorScheme][] = [
  ['light', light],
  ['dark', dark],
];

describe.each(schemes)('%s palette contrast (WCAG 2.2 AA)', (_name, c) => {
  it.each([
    ['text on bg', c.text, c.bg],
    ['text on surface', c.text, c.surface],
    ['text on raised surface', c.text, c.surfaceRaised],
    ['muted text on bg', c.textMuted, c.bg],
    ['muted text on surface', c.textMuted, c.surface],
    ['onAccent on accent', c.onAccent, c.accent],
    ['onAccent on accent hover', c.onAccent, c.accentHover],
    ['onDanger on danger', c.onDanger, c.danger],
    ['accent as text on bg', c.accent, c.bg],
    ['danger as text on bg', c.danger, c.bg],
    ['danger as text on surface', c.danger, c.surface],
    ['success as text on surface', c.success, c.surface],
    ['warning as text on surface', c.warning, c.surface],
  ])('%s is at least 4.5:1', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['strong border on bg', c.borderStrong, c.bg],
    ['strong border on surface', c.borderStrong, c.surface],
    ['focus ring on bg', c.focus, c.bg],
    ['focus ring on surface', c.focus, c.surface],
  ])('%s is at least 3:1 (non-text UI)', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('motion and touch', () => {
  it('keeps motion under 200ms', () => {
    expect(parseInt(motion.fast)).toBeLessThanOrEqual(200);
    expect(parseInt(motion.base)).toBeLessThanOrEqual(200);
  });
  it('uses 44px tap targets', () => {
    expect(tapTarget).toBeGreaterThanOrEqual(44);
  });
});

describe('generated CSS', () => {
  it('tokens.css matches tokens.ts (regenerate with `pnpm --filter @hazir/ui tokens`)', () => {
    const onDisk = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');
    expect(onDisk).toBe(buildCss());
  });
});

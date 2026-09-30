/**
 * Design tokens: the single source of truth. `tokens.css` is generated from this file
 * (run `pnpm --filter @hazir/ui tokens`); a test fails if they drift apart.
 *
 * The palette is a neutral placeholder. Rebranding means editing the values here.
 */
export type ColorScheme = {
  bg: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentHover: string;
  onAccent: string;
  danger: string;
  onDanger: string;
  success: string;
  warning: string;
  focus: string;
};

export const light: ColorScheme = {
  bg: '#faf8f5',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  text: '#1c1917',
  textMuted: '#57534e',
  border: '#d6d3d1',
  borderStrong: '#78716c',
  accent: '#9a3412',
  accentHover: '#7c2d12',
  onAccent: '#ffffff',
  danger: '#b91c1c',
  onDanger: '#ffffff',
  success: '#166534',
  warning: '#92400e',
  focus: '#1d4ed8',
};

export const dark: ColorScheme = {
  bg: '#14110f',
  surface: '#1f1b18',
  surfaceRaised: '#292420',
  text: '#f5f1ec',
  textMuted: '#b8b0a7',
  border: '#3d3732',
  borderStrong: '#8a8178',
  accent: '#fb923c',
  accentHover: '#fdba74',
  onAccent: '#1c1917',
  danger: '#f87171',
  onDanger: '#1c1917',
  success: '#4ade80',
  warning: '#fbbf24',
  focus: '#93c5fd',
};

/** 4px base scale. */
export const space = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
} as const;

export const radius = { sm: '0.375rem', md: '0.625rem', lg: '1rem', full: '9999px' } as const;

export const fontSize = {
  xs: '0.75rem',
  sm: '0.875rem',
  base: '1rem',
  lg: '1.125rem',
  xl: '1.375rem',
  '2xl': '1.75rem',
  '3xl': '2.25rem',
} as const;

export const lineHeight = { tight: '1.25', normal: '1.5', relaxed: '1.7' } as const;

export const motion = {
  /** Motion only shows a state change. Never longer than 200ms. */
  fast: '120ms',
  base: '180ms',
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/** Minimum tap target, in px (WCAG 2.2 AA is 24, we use 44 for one-handed use). */
export const tapTarget = 44;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function colorVars(scheme: ColorScheme, indent: string): string {
  return Object.entries(scheme)
    .map(([k, v]) => `${indent}--color-${kebab(k)}: ${v};`)
    .join('\n');
}

function scale(prefix: string, obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `  --${prefix}-${k}: ${v};`)
    .join('\n');
}

export function buildCss(): string {
  return `/* GENERATED from tokens.ts. Do not edit by hand. Run: pnpm --filter @hazir/ui tokens */
:root {
  color-scheme: light;
${colorVars(light, '  ')}
${scale('space', space)}
${scale('radius', radius)}
${scale('text', fontSize)}
${scale('leading', lineHeight)}
  --motion-fast: ${motion.fast};
  --motion-base: ${motion.base};
  --motion-ease: ${motion.ease};
  --tap-target: ${tapTarget}px;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
${colorVars(dark, '    ')}
  }
}

:root[data-theme='dark'],
[data-theme='dark'] {
  color-scheme: dark;
${colorVars(dark, '  ')}
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-fast: 0ms;
    --motion-base: 0ms;
  }
}
`;
}

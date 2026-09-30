# 0005. A tested component sheet instead of Storybook (for now)

Status: accepted (Phase 1), revisit at Phase 4

## Decision

The design system is shown on a real page (`/{locale}/design`) rendered in three languages and two themes. Playwright runs axe (WCAG 2.2 AA), tap-target, overflow, focus, reduced-motion and font-loading checks, and compares screenshots. This gives the same protection as Storybook with less tooling while there are only a handful of components. If the component count grows, add Storybook on top.

## Note on snapshots

Screenshots are generated on Linux with the self-hosted fonts. If CI fails only on pixel differences after an environment change, regenerate with `pnpm e2e --update-snapshots` in CI and review the images before committing.

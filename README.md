# Hazir

Software for restaurants: QR menu, ordering, kitchen and owner screens, with an AI helper that assists but never sits on the ordering path. See [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for the full plan and [`docs/adr/`](docs/adr) for decisions.

## Layout

| Path                  | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `apps/web`            | Next.js app (customer, kitchen, owner)                               |
| `packages/domain`     | Money and (later) order state, pricing, tax. Pure and heavily tested |
| `packages/db`         | Database test harness. Migrations live in `supabase/migrations`      |
| `packages/i18n`       | English, Hindi, Telugu messages and their consistency tests          |
| `packages/ui`         | Design tokens and components                                         |
| `e2e`                 | Playwright: accessibility, visual, browser checks                    |
| `supabase/migrations` | SQL migrations (forward-only)                                        |

## Getting started

Requires Node 22 and pnpm 10.

```bash
pnpm install
scripts/dev-db.sh start          # throwaway local Postgres for database tests
pnpm check                       # lint + types + unit + database tests + build
pnpm exec playwright install chromium   # once
pnpm e2e                         # browser, accessibility and visual tests
pnpm --filter @hazir/web dev     # http://localhost:3000
```

The Playwright config uses `CHROMIUM_PATH` if set, otherwise the browser installed by Playwright.

## Rules that CI enforces

- Every public table has row-level security enabled and forced, with no access for anonymous users.
- Every new tenant table must be added to the cross-tenant test registry.
- The design tokens meet WCAG 2.2 AA contrast; every page passes axe in all languages and both themes.
- Locale files have identical keys and correct scripts; a missing translation is an error.
- Money is integer paise only.

## Design tokens

`packages/ui/src/tokens.ts` is the source of truth. After editing: `pnpm --filter @hazir/ui tokens` (a test fails if `tokens.css` is stale).

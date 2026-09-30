# Phase 1 acceptance script

Run this yourself. Any step that does not match the expected result blocks the phase. Note the result of each step.

## A. Automated gate

1. `pnpm install`
2. `scripts/dev-db.sh start`
3. `pnpm check`
   - Expect: lint clean, types clean, all unit tests pass (domain 29, i18n 8, ui 37, web 5, database 32), production build succeeds.
4. `pnpm exec playwright install chromium`, then `pnpm e2e`
   - Expect: 62 passing tests (health, redirect, 404, security headers, and for each of 3 languages x 2 themes x mobile/desktop: accessibility, tap targets, overflow, screenshot; plus fonts, reduced motion, focus).

## B. Look at it on a real phone and a real computer

Start the app with `pnpm --filter @hazir/web dev`, then open `http://<your-computer-ip>:3000/en/design` on your phone (same Wi-Fi), or use a deployed preview once hosting exists.

5. The English page loads with the heading "Component sheet", three language buttons at the top, then buttons, text fields and three message boxes. Expected: nothing cut off, no sideways scrolling.
6. Tap **हिन्दी**. Expected: every word becomes Hindi, letters look correct (no empty boxes, joined letters look natural).
7. Tap **తెలుగు**. Expected: same for Telugu.
8. Tap each button with one thumb. Expected: each is comfortable to hit, and pressing gives a visible change.
9. Switch the phone to dark mode (or add `?theme=dark` to the address). Expected: dark background, all text readable, the orange button clearly visible.
10. Turn on "reduce motion" in the phone's accessibility settings and reload. Expected: nothing animates.
11. Rotate the phone sideways and back. Expected: layout adjusts, nothing overlaps.
12. Open `/api/health`. Expected: a small message containing `"status":"ok"`.
13. Open `/fr/design`. Expected: a 404 page, not a crash.

## C. Your judgement (write down what you think)

14. Does the look feel calm and clear, or generic? What would you change? (The palette and name are placeholders; the structure, spacing and type are what we are judging.)
15. Read the Hindi and Telugu text. Ask a native speaker if you are not sure. Which words sound wrong or unnatural?

## D. Items that need something from you before they can be checked

16. **Deploy and rollback drill.** Needs a hosting choice and account. Until then this gate item is open.
17. **Supabase project.** Needs a Supabase project under your account so migrations run against the real service and the row-level security tests are repeated there.
18. **Sentry.** Error tracking is not wired yet because it needs a project key. Structured JSON logging is in place.
19. **Branch protection.** In GitHub settings, require the CI jobs to pass before merging to `main`. Then a broken commit is blocked. (Locally, a broken change already fails `pnpm lint` and `pnpm typecheck`.)

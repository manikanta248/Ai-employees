# Hazir: Production Build Plan

Hazir is restaurant software with an AI staff member inside it. It starts as the **Waiter** (QR menu, ordering, payment, kitchen and owner screens) and is built so that later roles (Cashier, Host, Manager, Marketer) plug in without a rewrite.

This document is the plan only. No code is written until this plan is agreed. Phase 0 (demand validation) from the earlier plan is out of scope here; we are building the product.

---

## 0. Ground rules

**"No mistakes" is a process goal, not a promise.** Bugs can't be ruled out by intent. What we can do is make each one hard to ship, quick to detect and cheap to fix. That is what the gates in this plan are for.

1. **One phase at a time.** A phase ends only when every item in its exit checklist passes and you have signed off after your own manual test. No phase starts early.
2. **Every phase ships a working slice.** Nothing is "half built, finished later".
3. **The core path never depends on AI.** Browse, add to cart, pay and kitchen receipt work with the AI switched off. AI is an assist layer.
4. **Boring technology for the money and the data.** Postgres, standard auth, a mainstream payment gateway. Novelty goes only where it earns its keep (menu extraction, order assist).
5. **Decisions are written down** in `docs/adr/` (one short file per decision), so we don't re-litigate them.
6. **No placeholder anything in shipped UI.** No lorem ipsum, stock filler, fake testimonials or dead buttons. If a feature isn't built, it isn't shown.

---

## 1. Scale targets (design assumptions to size against)

These are assumptions, to be replaced with measured numbers after the pilot.

| Dimension | Design target |
|---|---|
| Restaurants (tenants) | 5,000 |
| Orders per restaurant per day | 300 (average), 1,000 (busy) |
| Orders per day, platform | about 1.5M |
| Peak order writes | about 150 per second (lunch/dinner burst) |
| Concurrent customer sessions | 100k+ |
| Menu page load (4G, mid-range Android) | under 2 s to interactive |
| Order placed to kitchen screen | under 2 s, p95 |
| API availability | 99.9% monthly, with a stricter target for order + payment paths |
| Data loss | Zero acknowledged orders lost (point-in-time recovery on) |

Cost target: infrastructure plus AI under ₹5 per order at scale, tracked per restaurant from day one.

---

## 2. Architecture

### 2.1 Shape
A **modular monolith**, not microservices. One deployable backend with strict module boundaries (`tenancy`, `menu`, `orders`, `payments`, `kitchen`, `ai`, `reporting`, `notifications`). Modules talk through typed interfaces, and a module can later be extracted if load demands it. Microservices at this stage would add failure modes without adding capacity.

### 2.2 Stack (proposed, confirm in Phase 0)

| Layer | Choice | Why |
|---|---|---|
| Web app | Next.js (App Router), TypeScript strict, PWA | One codebase for customer, kitchen and owner apps |
| Database | Postgres (managed, Supabase or equivalent) | Transactions, RLS, mature scaling path |
| Realtime | Postgres changes / Supabase Realtime, with polling fallback | Kitchen screen must never go silently stale |
| Jobs | pg-boss (queue in Postgres) | Retries, idempotency, no extra infrastructure |
| Cache / edge | Cloudflare (CDN for menus, WAF, rate limits) | Menus are read-heavy and cacheable |
| Payments | Gateway with split/marketplace settlement (Razorpay Route or Cashfree; decided in an ADR) | Money settles to the restaurant, not to us |
| AI | Model behind our own gateway layer (see 2.5) | Swappable, capped, logged |
| Observability | Sentry (errors), PostHog (product), structured logs, uptime probes | |
| CI/CD | GitHub Actions, preview deploys per PR, staged rollout | |

Open item: managed Supabase versus plain managed Postgres plus our own auth/realtime. See Section 11.

### 2.3 Multi-tenancy
- Every business table carries `restaurant_id`.
- **Row-level security on every table**, deny by default. The app role can never read across tenants even if application code has a bug.
- Automated test that tries cross-tenant reads and writes on every table and fails CI if any succeeds.
- Roles: `owner`, `manager`, `kitchen`, `cashier`, and anonymous `customer` (session-scoped, no account needed to order).
- Per-tenant config (tax, service charge, hours, discount limits, AI limits) in typed tables, not free JSON blobs.

### 2.4 Core data model (first draft)
`restaurants`, `outlets`, `staff_members`, `menu_categories`, `menu_items`, `modifier_groups`, `modifiers`, `tables`, `table_sessions`, `carts`, `orders`, `order_items`, `order_events` (append-only status history), `payments`, `refunds`, `webhook_events` (raw, for replay), `sold_out_flags`, `audit_log`, `ai_sessions`, `ai_tool_calls`, `usage_metering`.

Rules:
- **Money is integer paise**, never floats. One currency helper, used everywhere.
- Orders snapshot item name, price and tax at order time. A later menu edit never changes a past order.
- Order state is a **finite state machine** (`created → paid → accepted → preparing → ready → served`, plus `cancelled` / `refunded`) enforced in one place and covered by exhaustive tests.
- `orders` is designed for partitioning by date from the start (partition key chosen now, partitions turned on when volume needs it).
- All writes that can be retried carry an **idempotency key**.

### 2.5 AI layer (assist only)
- The model never sees or emits prices from its own memory. It calls typed tools (`search_menu`, `get_item`, `add_to_cart`, `suggest_addon`, `call_staff`) that read the database. Prices and availability always come from the DB.
- Every tool call is validated against a schema and against the restaurant's rules (max discount, allowed upsell items, sold-out state) **before** it takes effect.
- Output is checked: any item or price in a reply must map to a real record, or the reply is dropped and a safe fallback shown.
- Per-session token cap, per-restaurant daily cap, circuit breaker. If the AI errors or is slow (over 3 s), the UI silently falls back to the normal menu, with no error screen.
- Everything is logged (input, tool calls, output, cost) so wrong behaviour can be replayed and turned into a regression test.
- Model choice is decided by an evaluation set (Section 5.5), not by preference.

### 2.6 Payments (the highest-risk module)
- Customer pays by UPI through the gateway. Funds settle directly to the restaurant's account. Hazir never holds restaurant money.
- Order is confirmed **only** from a verified, signed gateway webhook, never from the browser redirect.
- Webhooks: signature verified, stored raw, processed idempotently, replayable. A reconciliation job compares our records to the gateway daily and flags any mismatch.
- Handled and tested cases: double tap, payment succeeds but the browser closes, webhook arrives late, webhook arrives twice, payment fails after the order screen, partial refund, gateway outage.
- Before Phase 3 exits: confirm the gateway's regulatory and KYC requirements for marketplace settlement (needs a human check with the gateway; not assumed).

### 2.7 Reliability
- Stateless app servers, horizontally scaled behind the CDN. Database: connection pooling, read replica for reporting, PITR backups, and a restore drill (a backup that hasn't been restored isn't a backup).
- Kitchen screen: realtime connection with automatic reconnect, a visible "connection lost" state, and polling fallback. Audible alert on a new order, with a tested unmute flow.
- Menus are served from cache. If the origin is down, customers still see the menu.
- Rate limits on every public endpoint. Bot protection on ordering.
- Graceful degradation ladder: AI off, then realtime to polling, then a read-only menu with a "call staff" message. Each rung is tested.

### 2.8 Security and privacy
- OWASP ASVS-based checklist per phase. Dependency and secret scanning in CI.
- Auth: email/phone OTP for staff, short-lived sessions, role checks on the server, never only in the UI.
- Least data: customers order without an account. Store only what fulfilment needs.
- Consent capture and data-deletion flow built early. Confirm current DPDP Rules obligations and dates with a lawyer before pilot launch; don't rely on press summaries.
- Audit log for staff actions on menus, prices and refunds.
- Secrets in the platform's secret store, never in the repo. Separate dev, staging and production projects.

---

## 3. Design system (how we avoid generic "AI-made" output)

The interface is a tool that staff use for hours under pressure and customers use one-handed in a dim cafe. Design decisions come from that, not from a template.

1. **Design before build, per phase.** Key screens are designed in Figma (or agreed wireframes) and approved by you before implementation.
2. **Tokens first:** one type scale, one spacing scale, one radius set, a restrained colour palette with contrast checked, dark mode for the kitchen. No ad-hoc values in components.
3. **Real content only.** Designs and demos use a real cafe's real menu and real photos, not lorem ipsum, gradient blobs, emoji stand-ins for icons, or generic stock images.
4. **No decoration without a job.** No glassmorphism, no gratuitous gradients, no animation that delays a tap. Motion is used only to show state change (item added, order status) and is under 200 ms. `prefers-reduced-motion` respected.
5. **Copy written by hand,** short, in the customer's language. English, Hindi and Telugu strings go through a translation file reviewed by a native speaker. No machine-translated UI shipped unreviewed.
6. **Touch and speed:** 44px minimum targets, thumb-zone actions, ordering completes in under 30 s for a known item. Measured with real users, not asserted.
7. **Accessibility:** WCAG 2.2 AA, checked by automated tools (axe) and by hand (screen reader, zoom, keyboard).
8. **Empty, loading, error and offline states are designed,** not left to defaults.
9. **A component library** (Storybook) with visual-regression snapshots so an accidental UI change fails CI.
10. **Device matrix:** low-end Android on 3G/4G throttling, mid-range Android, recent iPhone, a cheap kitchen tablet, and desktop for the owner.

---

## 4. Repository and engineering standards

```
/apps/web            Next.js app (customer, kitchen, owner)
/packages/db         schema, migrations, RLS policies, seed data
/packages/domain     order state machine, money, pricing, tax (pure, heavily tested)
/packages/ai         tool definitions, guardrails, eval harness
/packages/ui         design system components + tokens
/packages/config     lint, tsconfig, shared config
/docs                plan, ADRs, runbooks, API docs
/e2e                 Playwright suites
/load                k6 load scripts
```

- TypeScript `strict`, no `any` without a comment. Zod schemas at every boundary (HTTP, webhook, AI tool I/O).
- Migrations are forward-only, reviewed, and tested against a copy of staging.
- Conventional commits, small PRs, required checks before merge, no direct pushes to `main`.
- Feature flags for anything not yet safe to expose.
- Runbooks written for each alert **before** the alert goes live.

---

## 5. Testing system (applied in every phase)

### 5.1 Automated (CI blocks merge on failure)
| Layer | Tooling | Scope |
|---|---|---|
| Unit | Vitest | Domain logic: money, tax, pricing, state machine (target near-100% on `domain`) |
| Property-based | fast-check | Money rounding, cart totals, state transitions |
| Database | pgTAP or integration tests | RLS policies, constraints, migrations |
| API/integration | Vitest + test DB | Every endpoint, including auth and tenant isolation |
| Contract | Zod schemas / OpenAPI checks | Webhooks and AI tool I/O |
| E2E | Playwright | Full customer order, kitchen flow, owner flow on mobile viewports |
| Visual regression | Storybook + snapshots | Design system |
| Accessibility | axe in CI | Every page |
| Static | ESLint, tsc, dependency + secret scan | Always |

### 5.2 Non-functional (run at phase gates)
- **Load:** k6 against staging at 2x the target peak, holding for 30 minutes. Pass = SLOs met and no errors on the order path.
- **Soak:** 24 hours at average load, watching for leaks.
- **Chaos:** kill the realtime connection, delay webhooks, drop the AI provider, fail over the database in staging.
- **Security:** dependency audit, ASVS checklist, RLS bypass attempts, then an external penetration test before the pilot.
- **Backup/restore drill** and rollback drill before launch.

### 5.3 Manual test pass by you (end of every phase)
Each phase provides a written **acceptance script**: numbered steps to perform on a real phone and a real tablet, and the expected result of each. You run it, and any failure blocks the phase.

### 5.4 Definition of done (per feature)
Code reviewed, tests written and green, designed states all present, accessibility checked, analytics event defined, error handling and logging in place, docs/runbook updated, works on the device matrix.

### 5.5 AI evaluation
- A fixed evaluation set: at least 300 real utterances (Hinglish, Telugu, English, noisy phrasing, modifiers like "less sugar", ambiguous or out-of-menu requests, attempts to get free items).
- Metrics: item accuracy, modifier accuracy, invented-item rate (target **0**), price-quote errors (target **0**), refusal correctness, latency, cost per session.
- The suite reruns on every prompt, tool or model change. A drop in any metric blocks the change.
- Ship-gate: at least 95% item accuracy on the set, zero invented items or prices.

---

## 6. Phases

Each phase lists deliverables, then the **exit gate**. A gate has automated checks, your manual acceptance run, and a short review of what we learned.

### Phase 1: Foundations
**Build**
- Monorepo, CI pipeline, environments (dev/staging/prod), preview deploys, secrets handling.
- Database project with migration tooling; first schema (`restaurants`, `staff_members`, tenancy base) and RLS test harness.
- Design tokens, base components, Storybook, visual-regression and axe in CI.
- Observability wired: Sentry, structured logs, uptime probe, a health endpoint.
- ADRs for: stack, payment gateway shortlist, auth approach, realtime approach.

**Exit gate**
- CI is green from a clean clone in under 10 minutes; a deliberately broken commit is blocked.
- Cross-tenant RLS test suite exists and passes; a deliberately unsafe policy makes it fail (proves the test works).
- A "hello" page deploys to preview and prod through the pipeline; rollback tested once.
- Your sign-off on the design tokens and component sheet.

### Phase 2: Tenancy, auth, menu core
**Build**
- Staff sign-in, roles, restaurant and outlet setup, table management, printable table QR generation (unique, signed, revocable).
- Full menu model: categories, items, photos, modifiers, tax rules, availability windows, sold-out toggle, multi-language names.
- Owner menu editor (fast, keyboard and touch friendly), with undo and change history.
- Image pipeline: upload, resize, modern formats, CDN.
- Audit log for menu and price changes.

**Exit gate**
- Full test suite green; RLS tests cover every new table.
- An owner can create a real menu of 60+ items with modifiers in one sitting; you time it and note friction.
- Menu public read is served from cache; measured p95 under target.
- Acceptance script passed on phone and tablet.

### Phase 3: Onboarding engine (menu from photo or PDF)
**Build**
- Upload from web or WhatsApp-forwarded file; pre-processing (rotate, crop, enhance).
- Vision extraction into structured items, prices, categories and modifiers, with a per-field confidence score.
- **Review screen**: side-by-side original and extracted data, low-confidence fields highlighted, bulk edit, approve to publish. Nothing goes live without human approval.
- Import history and re-import diffing (so a new menu photo updates rather than duplicates).
- Extraction evaluation set: at least 30 real menus (printed, handwritten, chalkboard, multi-language, PDFs, poor lighting).

**Exit gate**
- Extraction field accuracy measured and recorded per menu type; the review screen makes correcting the rest fast.
- Median time from photo to live menu for a 60-item cafe menu is under 15 minutes including review (timed with you as the operator).
- Malicious/oversized/corrupt file tests pass; extraction failure leaves the owner with a clear path (manual entry), never a dead end.
- Cost per menu import logged.

### Phase 4: Customer ordering and payments (no AI yet)
**Build**
- QR opens a fast menu-first page: categories, search, photos, item detail with modifiers, cart, notes.
- Table session model (multiple people at one table can add to one order, if the owner enables it).
- Checkout: tax and service charge displayed correctly, UPI payment via the gateway, order confirmation only on verified webhook.
- Order state machine, status page for the customer, cancellation and refund rules per restaurant.
- Webhook pipeline (signature verify, raw store, idempotent processing, replay tool) and daily reconciliation job.
- Pay-at-counter option for restaurants that want it (configurable).

**Exit gate**
- Payment failure matrix (Section 2.6) fully automated and passing; each case also run by hand against the gateway's sandbox.
- Ordering a known item takes under 30 s in timed tests with 5 people who have never seen the app.
- Load test at 2x peak passes on the order path.
- A small real-money test (your own transactions) settles correctly to a test merchant account and reconciles to the paisa.
- Legal/compliance check on payments (Section 2.6) done.

### Phase 5: Kitchen and owner screens
**Build**
- Kitchen display: live order queue, accept, prepare, ready, sound alert, per-table and per-order view, reprint, cancel with reason, sold-out toggle from the kitchen.
- Owner dashboard: today's sales, average bill, top items, order counts, hourly chart, payment status, exports (CSV).
- Realtime with reconnect, offline banner and polling fallback; order sync after reconnect.
- Notifications: customer order-ready (web push first; WhatsApp later).
- Optional: thermal printer support (decide after seeing what pilot cafes use).

**Exit gate**
- Kitchen screen survives the chaos tests (network drop, tab sleep, device lock, server restart) with no missed order in 10 consecutive runs.
- Numbers on the dashboard reconcile exactly with raw orders (automated test plus a manual audit of a day's orders).
- Acceptance script passed on the actual tablet model we intend to recommend.

### Phase 6: AI Waiter
**Build**
- AI service behind our gateway with tools, guardrails and caps (Section 2.5).
- Customer helper: text and voice input, recommendations, dietary questions from real menu data only, modifiers, "call staff".
- Owner controls: which items may be suggested, discount limits, AI on/off per restaurant and per table.
- Upsell logic v1: rule-based first (pairings the owner sets), AI phrasing on top. Learned recommendations only after there is real order data.
- Cost dashboard, per-session logs, replay tool for bad conversations.
- Evaluation suite (Section 5.5) running in CI.

**Exit gate**
- Ship-gate metrics met: at least 95% item accuracy, zero invented items or prices, zero unauthorised discounts across the full evaluation set plus a red-team set (prompt injection, "ignore your rules", price manipulation).
- AI fully disabled by flag with no impact on the order path (tested).
- AI provider outage test: customer sees the normal menu within 3 s, no error.
- Cost per order measured against the target.

### Phase 7: Hardening and launch readiness
**Build / verify**
- Full load, soak and chaos runs at target scale on staging.
- External penetration test; fix all high/critical findings.
- Backup restore drill, disaster runbook, on-call rota, alert thresholds and runbooks.
- Accessibility audit (automated and manual) on all screens; language review of all strings.
- Data privacy: consent capture, data export/deletion, retention policy, privacy notice, terms (lawyer-reviewed).
- Support tooling: impersonation with audit trail, tenant health view, onboarding checklist.
- Owner-facing help: short in-app guides, written and reviewed by hand.

**Exit gate**
- All prior phases' suites green on the release candidate.
- Zero open critical/high bugs; medium bugs triaged in writing.
- A 48-hour staging soak with simulated traffic, then a staged production rollout to one real restaurant while you watch.

### Phase 8: Pilot and iterate
- Roll out restaurant by restaurant, starting with a small number, with a daily review of errors, payment reconciliation and support tickets.
- Measure the metrics in the original plan (average bill lift, order accuracy, adoption, upsell acceptance) against the restaurant's own history.
- Feed real conversations into the AI evaluation set.
- Only after stable pilots: scale onboarding, pricing tests, and the next role (Cashier: split bills, receipts; then WhatsApp alerts; then POS integration).

---

## 7. Cross-cutting checklists

**Every PR:** tests added, types clean, no new `any`, migration reviewed, RLS policy for any new table, accessibility check, screenshots for UI changes.

**Every release:** changelog, staged rollout (1% → 10% → 100%) with automatic rollback on error-rate spike, post-release check of order/payment metrics.

**Every phase close:** acceptance script run by you, retro written, plan updated with what we learned, ADRs current.

---

## 8. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Payment/webhook edge cases lose or duplicate orders | Severe | Idempotency, signed webhooks, reconciliation, full failure matrix, real-money tests |
| Tenant data leak | Severe | RLS deny-by-default, cross-tenant test suite in CI, pen test |
| Kitchen misses an order at rush hour | Severe | Realtime + polling, alerts, chaos tests, visible connection state |
| AI says something wrong (item, price, discount) | High | Tool-only facts, output validation, evaluation gate, kill switch |
| Menu extraction wrong on messy menus | High | Confidence scores, mandatory human review, real-menu test set |
| Scope creep (adding roles before the Waiter is solid) | High | Phase gates; new roles only after Phase 8 |
| Cost per order too high | Medium | Caps, per-restaurant cost dashboard, cheapest model that passes evaluation |
| Regulatory changes (payments, privacy) | Medium | Lawyer/gateway confirmation before pilot; ADR log |
| Solo-builder bottleneck | Medium | Small vertical slices, strong automation, documented runbooks |

---

## 9. What "done" looks like for the Waiter v1

- A restaurant is live in under 15 minutes from a menu photo.
- A customer orders and pays in under 30 seconds from QR scan.
- The kitchen never misses an order, and the owner's numbers match the money received to the paisa.
- The AI helps and never invents anything; turning it off changes nothing else.
- Passes load, security, accessibility and disaster drills, with your sign-off at every phase.

---

## 10. Working method (how we run phases)

1. At the start of each phase I post a short spec: screens, data, edge cases, acceptance script.
2. You approve or amend it. I then build in small commits on the working branch.
3. I run the full automated gate and report the results honestly, including anything failing.
4. You run the acceptance script on real devices and report back.
5. We fix, re-run, and only then close the phase.

---

## 11. Decisions I need from you before Phase 1

1. **Backend platform:** Supabase (faster, includes auth/realtime/RLS, with some vendor lock-in) or plain managed Postgres plus our own auth/realtime layer (more work, more control). My recommendation: Supabase, with the domain logic kept in our own packages so we can move later.
2. **Payment gateway:** Razorpay Route or Cashfree (both offer split settlement). I'd like you to open sandbox accounts on both, and we pick on fees, KYC friction and webhook reliability.
3. **Languages at launch:** English plus Telugu and Hindi, or English only first?
4. **Hosting region and budget ceiling** for staging and production.
5. **Design input:** do you have brand colours, a logo or a name confirmed for "Hazir"? If not, Phase 1 includes a short brand and design-token round.
6. **Who reviews legal items** (payment compliance, privacy, terms)? A lawyer or advisor should be lined up before Phase 4.
7. **Devices:** which kitchen tablet and phones will you test on?

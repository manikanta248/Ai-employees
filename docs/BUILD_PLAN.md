# Hazir: Production Build Plan

Hazir is restaurant software with an AI staff member inside it. It starts as the **Waiter** (QR menu, ordering, payment, kitchen and owner screens) and is built so that later roles (Cashier, Host, Manager, Marketer) plug in without a rewrite.

This document is the plan only. No code is written until this plan is agreed. Phase 0 (demand validation) from the earlier plan is out of scope here; we are building the product.

---

## 0. Ground rules

**"No mistakes" is a process goal, not a promise.** Bugs can't be ruled out by intent. What we can do is make each one hard to ship, quick to detect and cheap to fix. That is what the gates in this plan are for.

1. **One phase at a time.** A phase ends only when every item in its exit checklist passes and you have signed off after your own manual test. No phase starts early.
2. **Every phase ships a working slice.** Nothing is "half built, finished later".
3. **The core path never depends on AI.** Browse, add to cart, pay and kitchen receipt work with the AI switched off. AI is an assist layer.
4. **Boring technology for the money and the data.** Postgres, standard auth, Razorpay Route so restaurants receive their own money. Novelty goes only where it earns its keep (menu extraction, order assist).
5. **Decisions are written down** in `docs/adr/` (one short file per decision), so we don't re-litigate them.
6. **No placeholder anything in shipped UI.** No lorem ipsum, stock filler, fake testimonials or dead buttons. If a feature isn't built, it isn't shown.

---

## 1. Scale targets (design assumptions to size against)

These are assumptions, to be replaced with measured numbers after the pilot.

| Dimension                              | Design target                                                   |
| -------------------------------------- | --------------------------------------------------------------- |
| Restaurants (tenants)                  | 5,000                                                           |
| Orders per restaurant per day          | 300 (average), 1,000 (busy)                                     |
| Orders per day, platform               | about 1.5M                                                      |
| Peak order writes                      | about 150 per second (lunch/dinner burst)                       |
| Concurrent customer sessions           | 100k+                                                           |
| Menu page load (4G, mid-range Android) | under 2 s to interactive                                        |
| Order placed to kitchen screen         | under 2 s, p95                                                  |
| API availability                       | 99.9% monthly, with a stricter target for order + payment paths |
| Data loss                              | Zero acknowledged orders lost (point-in-time recovery on)       |

Cost target: infrastructure plus AI under ₹5 per order at scale, tracked per restaurant from day one.

---

## 2. Architecture

### 2.1 Shape

A **modular monolith**, not microservices. One deployable backend with strict module boundaries (`tenancy`, `menu`, `orders`, `payments`, `kitchen`, `ai`, `reporting`, `notifications`). Modules talk through typed interfaces, and a module can later be extracted if load demands it. Microservices at this stage would add failure modes without adding capacity.

### 2.2 Stack (proposed, confirm in Phase 0)

| Layer         | Choice                                                                                                                               | Why                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Web app       | Next.js (App Router), TypeScript strict, PWA                                                                                         | One codebase for customer, kitchen and owner apps            |
| Database      | Postgres (managed, Supabase or equivalent)                                                                                           | Transactions, RLS, mature scaling path                       |
| Realtime      | Postgres changes / Supabase Realtime, with polling fallback                                                                          | Kitchen screen must never go silently stale                  |
| Jobs          | pg-boss (queue in Postgres)                                                                                                          | Retries, idempotency, no extra infrastructure                |
| Cache / edge  | Cloudflare (CDN for menus, WAF, rate limits)                                                                                         | Menus are read-heavy and cacheable                           |
| Payments      | Razorpay Route (each restaurant is a linked account, settles to them), plus cash/card at counter and an optional manual UPI fallback | Decided by you. Hazir never holds restaurant money (see 2.6) |
| AI            | Model behind our own gateway layer (see 2.5)                                                                                         | Swappable, capped, logged                                    |
| Observability | Sentry (errors), PostHog (product), structured logs, uptime probes                                                                   |                                                              |
| CI/CD         | GitHub Actions, preview deploys per PR, staged rollout                                                                               |                                                              |

Decided: Supabase. Domain logic stays in our own packages so we can move off later (Section 11).

### 2.3 Multi-tenancy

- Every business table carries `restaurant_id`.
- **Row-level security on every table**, deny by default. The app role can never read across tenants even if application code has a bug.
- Automated test that tries cross-tenant reads and writes on every table and fails CI if any succeeds.
- Roles: `owner`, `manager`, `kitchen`, `cashier`, and anonymous `customer` (session-scoped, no account needed to order).
- Per-tenant config (tax, service charge, hours, discount limits, AI limits) in typed tables, not free JSON blobs.

### 2.4 Core data model (first draft)

`restaurants`, `outlets`, `staff_members`, `menu_categories`, `menu_items`, `modifier_groups`, `modifiers`, `tables`, `table_sessions`, `carts`, `orders`, `order_items`, `order_events` (append-only status history), `payment_settings` (methods on/off, Razorpay linked-account id and KYC status, optional manual UPI ID, pay-first vs prepare-first mode), `payments` (provider, method, state, provider ids, confirmed_by, confirmed_at), `webhook_events` (raw, unique event id, for replay), `refunds` and `payment_adjustments` (reason, actor), `reconciliation_runs`, `cashup_days`, `sold_out_flags`, `audit_log`, `ai_sessions`, `ai_tool_calls`, `usage_metering`.

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

### 2.6 Payments (decided: Razorpay Route, plus counter payments)

**Hazir never holds restaurant money.** Online payments go through **Razorpay Route**: each restaurant is a linked account, and a customer's payment settles to that restaurant's own bank account. Hazir only records and displays payment state.

Payment methods per restaurant (owner turns each on or off):

1. **Pay online (Razorpay):** UPI, cards and other methods Razorpay offers, settling to the restaurant's linked account. Available once that restaurant's Razorpay linked-account KYC is approved.
2. **Pay at counter: cash.** Order goes to the kitchen, the cashier marks it paid.
3. **Pay at counter: card/POS machine.** Same flow, using the restaurant's own machine.
4. **Manual UPI (fallback, optional):** the restaurant's own UPI ID with an amount-filled UPI link/QR, confirmed by staff. It exists for restaurants still waiting for KYC approval, and it can be removed later.

Design rules:

- All providers sit behind one `PaymentProvider` interface and one payment state model: `unpaid → pending → paid`, or `pay_at_counter → paid`, or `failed`, `cancelled`, `refunded`, `partially_refunded`. Razorpay is one implementation, and manual/counter payment is another.
- **Online orders are confirmed only from a verified, signed Razorpay webhook**, never from the browser redirect or client callback. The client callback only updates the screen.
- Webhooks: signature verified, stored raw in `webhook_events`, processed idempotently (event id is unique), replayable. A **daily reconciliation job** compares our payment records with Razorpay's and flags any mismatch. Orders are created with server-side Razorpay order ids and amounts. The client never sends an amount we trust.
- Handled and tested cases: double tap on pay, payment succeeds but the browser closes, webhook arrives late, webhook arrives twice or out of order, payment fails after the order screen, customer pays after the order expired, partial refund, full refund, Razorpay outage (customer is offered counter payment), amount changed after items added.
- For counter and manual UPI payments, staff confirmation is required, written to the audit log, and shown on the end-of-day **cash-up screen** (totals by method, list of unconfirmed orders).
- Refunds: online refunds are issued through Razorpay by an owner/manager (permission-gated, reason required, audit logged). Cash/card refunds are recorded manually.
- Keys and secrets are stored server-side only. The webhook secret and API keys are never sent to the browser or committed.
- **Things to confirm with Razorpay before Phase 4 starts (I can't verify these from here):** that Hazir qualifies for Route as a platform, the linked-account onboarding and KYC steps for a small cafe, any fee on Route transfers on top of the payment fees, settlement timing, and how refunds and disputes are handled for linked accounts. Test mode should let us build without any of this, but the answers decide whether the production setup works.

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

| Layer             | Tooling                               | Scope                                                                           |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| Unit              | Vitest                                | Domain logic: money, tax, pricing, state machine (target near-100% on `domain`) |
| Property-based    | fast-check                            | Money rounding, cart totals, state transitions                                  |
| Database          | pgTAP or integration tests            | RLS policies, constraints, migrations                                           |
| API/integration   | Vitest + test DB                      | Every endpoint, including auth and tenant isolation                             |
| Contract          | Zod schemas / OpenAPI checks          | Razorpay webhooks, AI tool I/O and public API responses                         |
| E2E               | Playwright                            | Full customer order, kitchen flow, owner flow on mobile viewports               |
| Visual regression | Storybook + snapshots                 | Design system                                                                   |
| Accessibility     | axe in CI                             | Every page                                                                      |
| Static            | ESLint, tsc, dependency + secret scan | Always                                                                          |

### 5.2 Non-functional (run at phase gates)

- **Load:** k6 against staging at 2x the target peak, holding for 30 minutes. Pass = SLOs met and no errors on the order path.
- **Soak:** 24 hours at average load, watching for leaks.
- **Chaos:** kill the realtime connection, delay/duplicate webhooks, drop the AI provider, fail over the database in staging.
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
- ADRs for: stack, Razorpay Route integration and payment state model, i18n approach, auth approach, realtime approach.

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
- Language support: every menu item and category can hold English, Hindi and Telugu names and descriptions, with a fallback to English where a translation is missing.
- Image pipeline: upload, resize, modern formats, CDN.
- Audit log for menu and price changes.
- Owner payment settings screen (methods on/off, pay-first or prepare-first), built in Phase 4 but the table and permissions are created here.

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
- Checkout: tax and service charge displayed correctly; choose pay online (Razorpay), pay at counter (cash) or pay at counter (card).
- Razorpay Route integration: linked-account onboarding flow for the restaurant, server-side order creation, Razorpay checkout, signed webhook handler, idempotent processing, replay tool, daily reconciliation job.
- Order state machine plus separate payment state (Section 2.6), customer status page, cancellation and refund rules per restaurant.
- Staff "confirm payment" for counter/manual payments with audit trail, and the end-of-day cash-up screen.
- Refunds (online via Razorpay, permission-gated; manual entries for cash/card).

**Exit gate**

- Every case in the 2.6 test list is automated and passing against Razorpay **test mode**, and each is also run by hand.
- Webhook tests: bad signature is rejected, replayed event is a no-op, out-of-order events end in the right state.
- Real-money test: a few small live payments and one refund through a real linked account, settled to a real bank account and reconciled to the paisa. This needs a Razorpay live account, which is the first spend or approval step on the payments side.
- Ordering a known item takes under 30 s in timed tests with 5 people who have never seen the app.
- Load test at 2x peak passes on the order path.
- A day of simulated orders gives a cash-up and reconciliation total that matches the raw orders to the paisa.

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

- Roll out restaurant by restaurant, starting with a small number, with a daily review of errors, daily reconciliation against Razorpay and cash-up totals versus the restaurant's own receipts and support tickets.
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

| Risk                                                                                | Impact | Mitigation                                                                                                    |
| ----------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Payment edge cases lose or duplicate orders (online)                                | Severe | Server-side amounts, signed webhooks only, idempotency, reconciliation, full failure matrix, real-money test  |
| Counter payments: staff confirm the wrong order or a customer claims paid           | High   | Staff confirm against their own records, audit trail, cash-up screen lists unconfirmed orders, pay-first mode |
| Razorpay Route not available or restricted for our use, or restaurants' KYC delayed | High   | Confirm with Razorpay early, keep counter and manual UPI paths working, provider interface allows swapping    |
| Free-tier limits or missing backups on real data                                    | High   | See Section 11: paid database plan with backups before the first real restaurant                              |
| Tenant data leak                                                                    | Severe | RLS deny-by-default, cross-tenant test suite in CI, pen test                                                  |
| Kitchen misses an order at rush hour                                                | Severe | Realtime + polling, alerts, chaos tests, visible connection state                                             |
| AI says something wrong (item, price, discount)                                     | High   | Tool-only facts, output validation, evaluation gate, kill switch                                              |
| Menu extraction wrong on messy menus                                                | High   | Confidence scores, mandatory human review, real-menu test set                                                 |
| Scope creep (adding roles before the Waiter is solid)                               | High   | Phase gates; new roles only after Phase 8                                                                     |
| Cost per order too high                                                             | Medium | Caps, per-restaurant cost dashboard, cheapest model that passes evaluation                                    |
| Regulatory changes (privacy, terms)                                                 | Medium | Legal advisor and Razorpay confirmation before first real restaurant; ADR log                                 |
| Solo-builder bottleneck                                                             | Medium | Small vertical slices, strong automation, documented runbooks                                                 |

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

## 11. Decisions log

| #   | Decision                                                                                                                                                                                                                                        | Status                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | **Backend: Supabase.** Domain logic stays in our own packages (`domain`, `db`) so we can move off later if needed.                                                                                                                              | Decided                                             |
| 2   | **Payments: Razorpay Route** (each restaurant a linked account, settles to them), plus cash/card at counter and an optional manual UPI fallback (Section 2.6). Replaces the earlier no-gateway decision.                                        | Decided; Route eligibility to confirm with Razorpay |
| 3   | **Languages: English, Hindi, Telugu from the first release.** All UI strings go through a translation layer from Phase 1. Native-speaker review before pilot.                                                                                   | Decided                                             |
| 4   | **Brand and colours: placeholders.** "Hazir" is a working name. The design system uses swappable tokens (name, logo, palette, fonts), so a rebrand is a token change, not a rewrite. Placeholder palette is neutral and passes contrast checks. | Decided                                             |
| 5   | **Budget: ₹0 for now.** See below.                                                                                                                                                                                                              | Decided, with a hard limit noted                    |
| 6   | **Legal reviewer: not chosen yet.**                                                                                                                                                                                                             | Open, must close before the first real restaurant   |
| 7   | **Devices: no fixed model.** We support current Chrome on Android, Safari on iOS, and desktop Chrome/Edge for the owner, and test on emulated low-end devices in CI. You test on whatever you have.                                             | Decided                                             |

### 11.1 The ₹0 budget: what it allows and where it stops

Development and testing can run on free tiers of Supabase, Cloudflare and GitHub Actions. Free-tier terms change, so I'll check current limits when we set each one up rather than assume them. Two limits matter for the "production" goal:

- **Backups and uptime.** Free database tiers generally don't include point-in-time recovery and may pause when idle. That is fine for building and for a demo with fake data. It is **not** acceptable once a real restaurant's orders are in the database. The plan therefore has one hard rule: **before the first real restaurant goes live, the production database moves to a paid plan with backups, and we run a restore drill.** This is the first point where money is needed, and it's small compared with what a lost day of orders costs a restaurant.
- **Hosting terms.** Some free hosting plans forbid commercial use. Before launch we confirm that whichever host we use allows a commercial product on the plan we're on, and switch if not.
- **Payment fees.** Razorpay has no cost until money moves, but payments carry per-transaction fees, and Route may add its own. I haven't verified current rates. We confirm them before Phase 4 and show owners the real numbers. Test mode is free for development.
- **AI costs.** Free model quotas are small and can change. During development we use them for the evaluation suite, and we keep the per-session and per-restaurant caps from Section 2.5 so that a paid key later can't run away.
- **Where I need to keep things cheap on purpose:** no extra services we don't need (no separate queue or search service; pg-boss lives in Postgres), and cached menus so the database serves fewer reads.

### 11.2 Still needed from you (none block Phase 1)

- A legal advisor for the privacy notice, terms of service and any obligations from acting as a platform that onboards restaurants onto Razorpay.
- A Razorpay account (test mode is enough until Phase 4) and their answers to the Route questions in Section 2.6. Needed before the first real restaurant, so I'll remind you at the end of Phase 6.
- Access when we reach it: a Supabase account/project for you to own (I'll walk through the steps), a domain if you want one, and a Cloudflare account.

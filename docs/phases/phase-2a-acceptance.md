# Phase 2a acceptance (database and domain logic)

Phase 2 is split. **2a** (this) covers everything that can be proven without a Supabase project: the menu and table database layer, its security rules, and the pure logic for QR codes, menu validation and UPI links. **2b** (staff sign-in, restaurant setup screens, table QR sheet, menu editor, image upload) starts once a Supabase project exists.

## A. Automated gate

1. `scripts/dev-db.sh start`
2. `pnpm check` and expect: ui 37, i18n 8, domain 79, database 68, web 5 tests passing, and a successful build.
3. `pnpm e2e` and expect: 62 passing (unchanged from Phase 1).

## B. What the tests prove (read this list and tell me if a rule is wrong for real restaurants)

- One restaurant can never read, change, delete or create data in another, on all seven new tables, and can never link its own rows to another restaurant's rows.
- Owner and manager edit the menu, tables and payment settings. Kitchen and cashier can read everything and flip an item's sold-out switch, nothing else.
- Every item must say veg / non-veg / egg. Prices are whole paise between 0 and ₹1,00,000. Tax is at most 28%. Names need English; Hindi and Telugu are optional and never blank.
- Manual UPI cannot be switched on without a valid UPI ID and payee name. At least one payment method must stay on.
- Every menu, table, outlet and payment-settings change is written to the audit trail with old and new values and who did it; nothing is recorded when nothing changed.
- Customers see only active categories and items, sold-out and out-of-hours items show as not orderable, and no internal ids or fields leak.
- Revoking a table QR (version bump) or deactivating the table makes old stickers stop working immediately.

## C. Questions for you

- Are the rules above right? In particular: should **managers** be allowed to change payment settings (UPI ID), or only owners? (Currently both.)
- Should kitchen staff be able to mark a **whole category** sold out, or only single items? (Currently single items.)
- Do you want prices to allow a maximum other than ₹1,00,000?

## D. Needed from you for 2b

- A Supabase project (I will give exact steps). Free tier is fine for building.
- Decision on hosting for previews (still open from Phase 1).

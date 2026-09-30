# 0007. Customers read through two functions; table QR codes are signed and revocable

Status: accepted (Phase 2)

## Decision

- Anonymous visitors have **no access to any table**. They call exactly two functions, `get_public_menu(slug)` and `resolve_table(table_id, version)`, which return only what a customer may see (no `restaurant_id`, no inactive items, no internal fields). A CI test pins the list of functions anonymous users can run, so adding a third by accident fails the build.
- A table sticker encodes `v1.<tableId>.<version>.<HMAC-SHA256>`. The server verifies the signature, then `resolve_table` checks the table is active and `qr_version` matches. Bumping `qr_version` invalidates every printed sticker for that table. The signing secret lives only in the server environment (32+ characters).
- The sold-out switch is a separate function (`set_item_availability`) so kitchen and cashier can flip it without any right to edit the menu.
- Availability windows are evaluated in the outlet's timezone, including windows that cross midnight.
- `diet` (veg / non-veg / egg) has no default: the owner must state it for each item.
- Outlet-level rows exist (`outlets`, `dining_tables`) but the menu is per restaurant for now; per-outlet availability can be added without changing orders.

## Consequences

Menu reads are cacheable (Phase 7 puts a CDN in front). Rate limiting on the two public functions belongs in the app layer and is added with the customer app in Phase 4.

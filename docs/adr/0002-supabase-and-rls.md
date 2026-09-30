# 0002. Supabase, with row-level security as the tenant boundary

Status: accepted (Phase 1)

## Decision

Use Supabase (Postgres, Auth, Realtime, Storage). Tenant isolation is enforced **in the database** by row-level security, not only in application code:

- every business table has `restaurant_id`, RLS enabled **and forced**, and no access for `anon`;
- signed-in users get column-level grants (least privilege), never blanket table access;
- policies use `private.is_member()` / `private.has_role()` (SECURITY DEFINER, in a schema that is not exposed through the API);
- writes that need several steps go through controlled functions (e.g. `create_restaurant`);
- `audit_log` is append-only, enforced by triggers even against superusers.

Domain logic stays in our own packages so moving off Supabase later is possible.

## Guard rails (tests, run in CI)

- Structural test: every public table has forced RLS, no anon grants, no anon policies.
- Registry test: any new table with `restaurant_id` fails CI until it is added to the cross-tenant test registry.
- Cross-tenant probes, plus tests of the tests (a deliberately leaky policy must be detected).

## Consequences

A bug in application code cannot leak another restaurant's data. The cost is that every new table needs policies and tests, which is intended.

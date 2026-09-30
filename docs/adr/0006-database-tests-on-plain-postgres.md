# 0006. Database tests run against plain Postgres with a small Supabase stand-in

Status: accepted (Phase 1)

## Decision

`packages/db/tests_shim.sql` creates the `anon`, `authenticated` and `service_role` roles, an `auth.users` table and `auth.uid()`, matching Supabase's behaviour (including its default grants to those roles). Migrations in `supabase/migrations/` are then applied and tested against real Postgres 16, locally (`scripts/dev-db.sh start`) and in CI (service container). No Docker is needed locally.

## Limits

The shim is not the full Supabase stack. Before the first real deployment we also run the migrations against a real Supabase project (staging) and repeat the RLS tests there.

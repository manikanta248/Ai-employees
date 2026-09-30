import { describe, expect, it } from 'vitest';
import { actAsSuperuser, connect, inRollback, type Client } from './helpers';

/** Public tables that are missing RLS, or have it enabled but not forced. */
export async function tablesWithoutForcedRls(c: Client): Promise<string[]> {
  const r = await c.query<{ relname: string }>(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity)
    order by 1`);
  return r.rows.map((x) => x.relname);
}

/** Policies that apply to anon or PUBLIC. There must be none. */
export async function policiesOpenToAnon(c: Client): Promise<string[]> {
  const r = await c.query<{ tablename: string; policyname: string }>(`
    select tablename, policyname from pg_policies
    where schemaname = 'public' and (roles && array['anon', 'public']::name[]) order by 1, 2`);
  return r.rows.map((x) => `${x.tablename}.${x.policyname}`);
}

/** Tables anon holds any privilege on. There must be none. */
export async function tablesAnonCanTouch(c: Client): Promise<string[]> {
  const r = await c.query<{ table_name: string }>(`
    select distinct table_name from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'PUBLIC') order by 1`);
  return r.rows.map((x) => x.table_name);
}

/** Tables with a restaurant_id column, i.e. tenant data that needs a cross-tenant test. */
export async function tenantTables(c: Client): Promise<string[]> {
  const r = await c.query<{ table_name: string }>(`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'restaurant_id' order by 1`);
  return r.rows.map((x) => x.table_name);
}

/** Every tenant table must be registered here AND covered by rls-tenancy.test.ts. */
export const TENANT_TABLE_REGISTRY = ['audit_log', 'staff_members'];

describe('RLS structure (applies to every table, including ones added in later phases)', () => {
  it('has RLS enabled and forced on every public table', async () => {
    const c = await connect();
    expect(await tablesWithoutForcedRls(c)).toEqual([]);
    await c.end();
  });

  it('has no policy open to anon or PUBLIC', async () => {
    const c = await connect();
    expect(await policiesOpenToAnon(c)).toEqual([]);
    await c.end();
  });

  it('grants anon no privileges on any public table', async () => {
    const c = await connect();
    expect(await tablesAnonCanTouch(c)).toEqual([]);
    await c.end();
  });

  it('forces every new tenant table to be added to the cross-tenant test registry', async () => {
    const c = await connect();
    const found = await tenantTables(c);
    expect(found).toEqual([...TENANT_TABLE_REGISTRY].sort());
    await c.end();
  });
});

describe('the structural checks actually catch mistakes (tests of the tests)', () => {
  it('flags a table created without RLS', () =>
    inRollback(async (c) => {
      await actAsSuperuser(c);
      await c.query('create table public.oops (id int, restaurant_id uuid)');
      expect(await tablesWithoutForcedRls(c)).toContain('oops');
      expect(await tenantTables(c)).toContain('oops');
    }));

  it('flags a table with RLS enabled but not forced', () =>
    inRollback(async (c) => {
      await c.query('create table public.oops2 (id int)');
      await c.query('alter table public.oops2 enable row level security');
      expect(await tablesWithoutForcedRls(c)).toContain('oops2');
    }));

  it('flags a policy open to anon', () =>
    inRollback(async (c) => {
      await c.query('create table public.oops3 (id int)');
      await c.query('alter table public.oops3 enable row level security');
      await c.query('create policy p on public.oops3 for select to anon using (true)');
      expect(await policiesOpenToAnon(c)).toContain('oops3.p');
    }));
});

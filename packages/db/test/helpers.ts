import pg from 'pg';
import { inject } from 'vitest';

export type Client = pg.Client;

export async function connect(): Promise<Client> {
  const client = new pg.Client({ connectionString: inject('databaseUrl') });
  await client.connect();
  return client;
}

/** Runs `fn` inside a transaction that is always rolled back, so tests never interfere. */
export async function inRollback<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await connect();
  try {
    await c.query('begin');
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    await c.end();
  }
}

/** Act as a signed-in Supabase user (role `authenticated`, JWT sub = userId). */
export async function actAs(c: Client, userId: string): Promise<void> {
  await c.query('reset role');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
  await c.query('set local role authenticated');
}

/** Act as an anonymous visitor (role `anon`, no JWT). */
export async function actAsAnon(c: Client): Promise<void> {
  await c.query('reset role');
  await c.query(`select set_config('request.jwt.claims', '', true)`);
  await c.query('set local role anon');
}

export async function actAsSuperuser(c: Client): Promise<void> {
  await c.query('reset role');
  await c.query(`select set_config('request.jwt.claims', '', true)`);
}

/**
 * Run a statement that is expected to fail, without poisoning the surrounding transaction.
 * Returns the Postgres error code (e.g. 42501 = insufficient privilege, 23514 = check violation).
 */
export async function errorCodeOf(
  c: Client,
  sql: string,
  params: unknown[] = [],
): Promise<string | null> {
  await c.query('savepoint expect_error');
  try {
    await c.query(sql, params);
    await c.query('release savepoint expect_error');
    return null;
  } catch (err) {
    await c.query('rollback to savepoint expect_error');
    return (err as { code?: string }).code ?? 'unknown';
  }
}

export async function newUser(c: Client, email: string): Promise<string> {
  const r = await c.query<{ id: string }>(
    'insert into auth.users (email) values ($1) returning id',
    [email],
  );
  return r.rows[0]!.id;
}

export interface World {
  alice: string; // owner of Alpha
  bob: string; // owner of Beta
  manager: string; // manager at Alpha
  kitchen: string; // kitchen staff at Alpha
  stranger: string; // signed in, belongs to no restaurant
  alpha: string;
  beta: string;
}

/** Two restaurants with staff, created as the superuser for a known starting state. */
export async function seedWorld(c: Client): Promise<World> {
  await actAsSuperuser(c);
  const alice = await newUser(c, 'alice@example.test');
  const bob = await newUser(c, 'bob@example.test');
  const manager = await newUser(c, 'manager@example.test');
  const kitchen = await newUser(c, 'kitchen@example.test');
  const stranger = await newUser(c, 'stranger@example.test');

  await actAs(c, alice);
  const alpha = (
    await c.query<{ id: string }>(`select id from create_restaurant('Alpha Cafe', 'alpha-cafe')`)
  ).rows[0]!.id;
  await c.query(
    `insert into staff_members (restaurant_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'kitchen')`,
    [alpha, manager, kitchen],
  );

  await actAs(c, bob);
  const beta = (
    await c.query<{ id: string }>(`select id from create_restaurant('Beta Cafe', 'beta-cafe')`)
  ).rows[0]!.id;
  await actAsSuperuser(c);
  return { alice, bob, manager, kitchen, stranger, alpha, beta };
}

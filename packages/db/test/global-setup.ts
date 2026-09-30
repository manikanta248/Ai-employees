import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Creates a fresh, isolated database, applies the Supabase stand-in shim and every migration in
 * order, and drops it afterwards. Point TEST_DATABASE_URL at any Postgres 15+ superuser
 * connection (CI uses a service container; locally run `scripts/dev-db.sh start`).
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const adminUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:54329/postgres';
const dbName = `hazir_test_${process.pid}_${Date.now()}`;

function urlFor(db: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${db}`;
  return u.toString();
}

export async function setup(project: { provide: (k: string, v: string) => void }) {
  const admin = new pg.Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach Postgres at ${adminUrl}. Start one with scripts/dev-db.sh start or set TEST_DATABASE_URL.\n${String(err)}`,
    );
  }
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const db = new pg.Client({ connectionString: urlFor(dbName) });
  await db.connect();
  await db.query(readFileSync(new URL('../tests_shim.sql', import.meta.url), 'utf8'));
  const dir = join(root, 'supabase', 'migrations');
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    try {
      await db.query(readFileSync(join(dir, file), 'utf8'));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${String(err)}`);
    }
  }
  await db.end();
  project.provide('databaseUrl', urlFor(dbName));
}

export async function teardown() {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

import { describe, expect, it } from 'vitest';
import {
  actAs,
  actAsAnon,
  actAsSuperuser,
  errorCodeOf,
  inRollback,
  seedWorld,
  type Client,
  type World,
} from './helpers';

const count = async (c: Client, sql: string, params: unknown[] = []) =>
  Number((await c.query<{ n: string }>(`select count(*) n from (${sql}) q`, params)).rows[0]!.n);

describe('cross-tenant isolation', () => {
  it("Alice (Alpha owner) cannot see Beta's restaurant, staff or audit trail", () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.alice);
      expect(await count(c, 'select 1 from restaurants where id = $1', [w.beta])).toBe(0);
      expect(await count(c, 'select 1 from staff_members where restaurant_id = $1', [w.beta])).toBe(
        0,
      );
      expect(await count(c, 'select 1 from audit_log where restaurant_id = $1', [w.beta])).toBe(0);
      // and she sees her own
      expect(await count(c, 'select 1 from restaurants where id = $1', [w.alpha])).toBe(1);
      expect(await count(c, 'select 1 from restaurants')).toBe(1);
    }));

  it("cannot update or delete another restaurant's rows (silently affects 0 rows)", () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.alice);
      expect(
        (await c.query(`update restaurants set name = 'Hacked' where id = $1`, [w.beta])).rowCount,
      ).toBe(0);
      expect(
        (await c.query(`delete from staff_members where restaurant_id = $1`, [w.beta])).rowCount,
      ).toBe(0);
      await actAsSuperuser(c);
      expect(
        (await c.query(`select name from restaurants where id = $1`, [w.beta])).rows[0].name,
      ).toBe('Beta Cafe');
    }));

  it('cannot add herself or anyone to another restaurant', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.alice);
      const code = await errorCodeOf(
        c,
        `insert into staff_members (restaurant_id, user_id, role) values ($1, $2, 'owner')`,
        [w.beta, w.alice],
      );
      expect(code).toBe('42501');
    }));

  it('a signed-in user with no restaurant sees nothing', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.stranger);
      expect(await count(c, 'select 1 from restaurants')).toBe(0);
      expect(await count(c, 'select 1 from staff_members')).toBe(0);
      expect(await count(c, 'select 1 from audit_log')).toBe(0);
    }));

  it('cannot move a staff row to another restaurant', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.alice);
      // restaurant_id is not an updatable column for signed-in users at all
      const code = await errorCodeOf(
        c,
        `update staff_members set restaurant_id = $1 where user_id = $2`,
        [w.beta, w.kitchen],
      );
      expect(code).toBe('42501');
    }));
});

describe('anonymous visitors', () => {
  it.each(['restaurants', 'staff_members', 'audit_log'])('cannot read %s', (table) =>
    inRollback(async (c) => {
      await seedWorld(c);
      await actAsAnon(c);
      expect(await errorCodeOf(c, `select * from ${table}`)).toBe('42501');
    }),
  );

  it('cannot create a restaurant', () =>
    inRollback(async (c) => {
      await actAsAnon(c);
      expect(await errorCodeOf(c, `select create_restaurant('X Cafe', 'x-cafe')`)).toBe('42501');
    }));
});

describe('roles', () => {
  const asRole = async (c: Client, w: World, who: keyof World) => actAs(c, w[who]);

  it('owner and manager can rename the restaurant; kitchen cannot', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await asRole(c, w, 'alice');
      expect(
        (await c.query(`update restaurants set name = 'Alpha Renamed' where id = $1`, [w.alpha]))
          .rowCount,
      ).toBe(1);
      await asRole(c, w, 'manager');
      expect(
        (await c.query(`update restaurants set name = 'Alpha Again' where id = $1`, [w.alpha]))
          .rowCount,
      ).toBe(1);
      await asRole(c, w, 'kitchen');
      expect(
        (await c.query(`update restaurants set name = 'Nope' where id = $1`, [w.alpha])).rowCount,
      ).toBe(0);
    }));

  it('nobody can change the slug or id through the API', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await asRole(c, w, 'alice');
      expect(
        await errorCodeOf(c, `update restaurants set slug = 'stolen' where id = $1`, [w.alpha]),
      ).toBe('42501');
      expect(
        await errorCodeOf(c, `update restaurants set id = gen_random_uuid() where id = $1`, [
          w.alpha,
        ]),
      ).toBe('42501');
    }));

  it('only owners manage staff; managers and kitchen cannot', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await asRole(c, w, 'manager');
      expect(
        await errorCodeOf(
          c,
          `insert into staff_members (restaurant_id, user_id, role) values ($1, $2, 'cashier')`,
          [w.alpha, w.stranger],
        ),
      ).toBe('42501');
      expect(
        (await c.query(`update staff_members set role = 'owner' where user_id = $1`, [w.manager]))
          .rowCount,
      ).toBe(0);
      expect(
        (await c.query(`delete from staff_members where user_id = $1`, [w.kitchen])).rowCount,
      ).toBe(0);
      await asRole(c, w, 'kitchen');
      expect(
        (await c.query(`update staff_members set role = 'owner' where user_id = $1`, [w.kitchen]))
          .rowCount,
      ).toBe(0);
    }));

  it('all staff can see colleagues; only owner/manager can read the audit trail', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await asRole(c, w, 'kitchen');
      expect(await count(c, 'select 1 from staff_members')).toBe(3);
      expect(await count(c, 'select 1 from audit_log')).toBe(0);
      await asRole(c, w, 'manager');
      expect(await count(c, 'select 1 from audit_log')).toBeGreaterThan(0);
    }));

  it('the owner can add and remove staff', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await asRole(c, w, 'alice');
      const cashier = w.stranger;
      await c.query(
        `insert into staff_members (restaurant_id, user_id, role) values ($1, $2, 'cashier')`,
        [w.alpha, cashier],
      );
      expect(await count(c, `select 1 from staff_members where role = 'cashier'`)).toBe(1);
      expect(
        (await c.query(`delete from staff_members where user_id = $1`, [cashier])).rowCount,
      ).toBe(1);
    }));
});

describe('create_restaurant()', () => {
  it('makes the caller the owner and records an audit entry', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.stranger);
      const r = (
        await c.query<{ id: string }>(
          `select id from create_restaurant('  Gamma Cafe ', 'gamma-cafe', 'te')`,
        )
      ).rows[0]!;
      expect(
        await count(
          c,
          `select 1 from staff_members where restaurant_id = $1 and user_id = $2 and role = 'owner'`,
          [r.id, w.stranger],
        ),
      ).toBe(1);
      const row = (
        await c.query(`select name, default_locale from restaurants where id = $1`, [r.id])
      ).rows[0];
      expect(row).toEqual({ name: 'Gamma Cafe', default_locale: 'te' });
      expect(
        await count(
          c,
          `select 1 from audit_log where restaurant_id = $1 and action = 'restaurant.created'`,
          [r.id],
        ),
      ).toBe(1);
    }));

  it('rejects duplicate and malformed slugs and empty names', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.stranger);
      expect(await errorCodeOf(c, `select create_restaurant('Dup', 'alpha-cafe')`)).toBe('23505');
      for (const slug of ['ab', 'Has-Caps', 'has space', '-lead', 'trail-', 'dou--ble']) {
        expect(await errorCodeOf(c, `select create_restaurant('Ok', $1)`, [slug])).toBe('23514');
      }
      expect(await errorCodeOf(c, `select create_restaurant('   ', 'valid-slug')`)).toBe('23514');
    }));

  it('requires a signed-in user', () =>
    inRollback(async (c) => {
      await actAs(c, '00000000-0000-0000-0000-000000000000');
      await c.query(`select set_config('request.jwt.claims', '{"role":"authenticated"}', true)`);
      expect(await errorCodeOf(c, `select create_restaurant('No User', 'no-user')`)).toBe('28000');
    }));

  it('cannot insert into restaurants directly', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.stranger);
      expect(
        await errorCodeOf(
          c,
          `insert into restaurants (name, slug) values ('Direct', 'direct-cafe')`,
        ),
      ).toBe('42501');
    }));
});

describe('owner safety', () => {
  it('cannot remove or demote the last owner', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.alice);
      expect(await errorCodeOf(c, `delete from staff_members where user_id = $1`, [w.alice])).toBe(
        '23514',
      );
      expect(
        await errorCodeOf(c, `update staff_members set role = 'manager' where user_id = $1`, [
          w.alice,
        ]),
      ).toBe('23514');
    }));

  it('can demote an owner once another owner exists', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.alice);
      await c.query(`update staff_members set role = 'owner' where user_id = $1`, [w.manager]);
      expect(
        (await c.query(`update staff_members set role = 'manager' where user_id = $1`, [w.alice]))
          .rowCount,
      ).toBe(1);
    }));

  it('deleting the restaurant itself still cascades (superuser only)', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAsSuperuser(c);
      await c.query('delete from restaurants where id = $1', [w.alpha]);
      expect(
        await count(c, 'select 1 from staff_members where restaurant_id = $1', [w.alpha]),
      ).toBe(0);
    }));
});

describe('audit log', () => {
  it('records staff changes automatically', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.alice);
      await c.query(`update staff_members set role = 'cashier' where user_id = $1`, [w.kitchen]);
      const actions = (
        await c.query<{ action: string }>(
          `select action from audit_log where restaurant_id = $1 order by id`,
          [w.alpha],
        )
      ).rows.map((r) => r.action);
      expect(actions).toEqual([
        'restaurant.created',
        'staff.added',
        'staff.added',
        'staff.added',
        'staff.role_changed',
      ]);
      const last = (
        await c.query(`select actor_user_id from audit_log where action = 'staff.role_changed'`)
      ).rows[0];
      expect(last.actor_user_id).toBe(w.alice);
    }));

  it('cannot be written directly, edited, deleted or truncated (not even by a superuser)', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.alice);
      expect(
        await errorCodeOf(
          c,
          `insert into audit_log (restaurant_id, action, entity_table) values ($1, 'fake', 'x')`,
          [w.alpha],
        ),
      ).toBe('42501');
      expect(await errorCodeOf(c, `update audit_log set action = 'edited'`)).toBe('42501');
      expect(await errorCodeOf(c, `delete from audit_log`)).toBe('42501');
      await actAsSuperuser(c);
      expect(await errorCodeOf(c, `update audit_log set action = 'edited'`)).toBe('42501');
      expect(await errorCodeOf(c, `delete from audit_log`)).toBe('42501');
      expect(await errorCodeOf(c, `truncate audit_log`)).toBe('42501');
    }));
});

describe('the cross-tenant probe actually detects a leak (test of the tests)', () => {
  it('sees foreign rows when a table has a permissive policy', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAsSuperuser(c);
      await c.query(
        `create table public.leaky (id serial primary key, restaurant_id uuid not null)`,
      );
      await c.query(`alter table public.leaky enable row level security`);
      await c.query(
        `create policy everyone on public.leaky for select to authenticated using (true)`,
      );
      await c.query(`grant select on public.leaky to authenticated`);
      await c.query(`insert into public.leaky (restaurant_id) values ($1)`, [w.beta]);
      await actAs(c, w.alice);
      // Alice belongs to Alpha, yet the leaky policy exposes Beta's row. The probe must notice.
      expect(await count(c, 'select 1 from leaky where restaurant_id = $1', [w.beta])).toBe(1);
    }));

  it('sees nothing when the policy is scoped correctly', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAsSuperuser(c);
      await c.query(
        `create table public.tight (id serial primary key, restaurant_id uuid not null)`,
      );
      await c.query(`alter table public.tight enable row level security`);
      await c.query(
        `create policy members on public.tight for select to authenticated using (private.is_member(restaurant_id))`,
      );
      await c.query(`grant select on public.tight to authenticated`);
      await c.query(`insert into public.tight (restaurant_id) values ($1)`, [w.beta]);
      await actAs(c, w.alice);
      expect(await count(c, 'select 1 from tight where restaurant_id = $1', [w.beta])).toBe(0);
    }));
});

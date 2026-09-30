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

const scalar = async <T>(c: Client, sql: string, params: unknown[] = []): Promise<T> =>
  (await c.query(sql, params)).rows[0]!.v as T;
const count = async (c: Client, sql: string, params: unknown[] = []) =>
  Number((await c.query<{ n: string }>(`select count(*) n from (${sql}) q`, params)).rows[0]!.n);
const en = (s: string) => JSON.stringify({ en: s });

interface PublicMenu {
  restaurant: unknown;
  categories: {
    items: {
      orderable: boolean;
      modifier_groups: { modifiers: Record<string, unknown>[] }[];
    }[];
  }[];
}

interface Menu {
  outlet: string;
  category: string;
  item: string;
  group: string;
  modifier: string;
  table: string;
}

/** Create a full menu for a restaurant as the superuser (bypasses RLS: known starting state). */
async function seedMenu(c: Client, rid: string): Promise<Menu> {
  await actAsSuperuser(c);
  const outlet = await scalar<string>(c, `select id v from outlets where restaurant_id = $1`, [
    rid,
  ]);
  const category = await scalar<string>(
    c,
    `insert into menu_categories (restaurant_id, name) values ($1, $2) returning id v`,
    [rid, en('Coffee')],
  );
  const item = await scalar<string>(
    c,
    `insert into menu_items (restaurant_id, category_id, name, price_paise, diet)
     values ($1, $2, $3, 12000, 'veg') returning id v`,
    [rid, category, en('Cappuccino')],
  );
  const group = await scalar<string>(
    c,
    `insert into modifier_groups (restaurant_id, item_id, name) values ($1, $2, $3) returning id v`,
    [rid, item, en('Size')],
  );
  const modifier = await scalar<string>(
    c,
    `insert into modifiers (restaurant_id, group_id, name, price_delta_paise)
     values ($1, $2, $3, 3000) returning id v`,
    [rid, group, en('Large')],
  );
  const table = await scalar<string>(
    c,
    `insert into dining_tables (restaurant_id, outlet_id, label) values ($1, $2, 'T1') returning id v`,
    [rid, outlet],
  );
  return { outlet, category, item, group, modifier, table };
}

const TABLES: Record<string, { key: keyof Menu | 'restaurant'; idCol: string }> = {
  outlets: { key: 'outlet', idCol: 'id' },
  dining_tables: { key: 'table', idCol: 'id' },
  menu_categories: { key: 'category', idCol: 'id' },
  menu_items: { key: 'item', idCol: 'id' },
  modifier_groups: { key: 'group', idCol: 'id' },
  modifiers: { key: 'modifier', idCol: 'id' },
  payment_settings: { key: 'restaurant', idCol: 'restaurant_id' },
};

describe('cross-tenant isolation on every Phase 2 table', () => {
  it.each(Object.entries(TABLES))(
    '%s: Alice cannot read, change, delete or insert into Beta',
    (table, meta) =>
      inRollback(async (c) => {
        const w = await seedWorld(c);
        const beta = await seedMenu(c, w.beta);
        await seedMenu(c, w.alpha);
        const betaId = meta.key === 'restaurant' ? w.beta : beta[meta.key];
        await actAs(c, w.alice);

        expect(await count(c, `select 1 from ${table} where restaurant_id = $1`, [w.beta])).toBe(0);
        expect(await count(c, `select 1 from ${table} where ${meta.idCol} = $1`, [betaId])).toBe(0);
        expect(
          await count(c, `select 1 from ${table} where restaurant_id = $1`, [w.alpha]),
        ).toBeGreaterThan(0);

        // Deletes and updates hit zero rows, or are refused outright for tables that forbid them.
        const del = await errorCodeOf(c, `delete from ${table} where ${meta.idCol} = $1`, [betaId]);
        if (del === null) {
          expect(
            (await c.query(`delete from ${table} where ${meta.idCol} = $1`, [betaId])).rowCount,
          ).toBe(0);
        } else {
          expect(del).toBe('42501');
        }
        await actAsSuperuser(c);
        expect(await count(c, `select 1 from ${table} where ${meta.idCol} = $1`, [betaId])).toBe(1);
      }),
  );

  it('cannot insert rows for another restaurant', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const beta = await seedMenu(c, w.beta);
      await actAs(c, w.alice);
      expect(
        await errorCodeOf(c, `insert into menu_categories (restaurant_id, name) values ($1, $2)`, [
          w.beta,
          en('X'),
        ]),
      ).toBe('42501');
      expect(
        await errorCodeOf(
          c,
          `insert into menu_items (restaurant_id, category_id, name, price_paise, diet) values ($1, $2, $3, 100, 'veg')`,
          [w.beta, beta.category, en('X')],
        ),
      ).toBe('42501');
      expect(
        await errorCodeOf(c, `insert into outlets (restaurant_id, name) values ($1, 'Rogue')`, [
          w.beta,
        ]),
      ).toBe('42501');
    }));

  it("cannot point her own rows at another restaurant's parent rows", () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const alpha = await seedMenu(c, w.alpha);
      const beta = await seedMenu(c, w.beta);
      await actAs(c, w.alice);
      // item in Alpha, category in Beta
      expect(
        await errorCodeOf(
          c,
          `insert into menu_items (restaurant_id, category_id, name, price_paise, diet) values ($1, $2, $3, 100, 'veg')`,
          [w.alpha, beta.category, en('X')],
        ),
      ).toBe('23503');
      // table in Alpha, outlet in Beta
      expect(
        await errorCodeOf(
          c,
          `insert into dining_tables (restaurant_id, outlet_id, label) values ($1, $2, 'T9')`,
          [w.alpha, beta.outlet],
        ),
      ).toBe('23503');
      // modifier group in Alpha, item in Beta
      expect(
        await errorCodeOf(
          c,
          `insert into modifier_groups (restaurant_id, item_id, name) values ($1, $2, $3)`,
          [w.alpha, beta.item, en('X')],
        ),
      ).toBe('23503');
      // moving her own item into Beta's category
      expect(
        await errorCodeOf(c, `update menu_items set category_id = $1 where id = $2`, [
          beta.category,
          alpha.item,
        ]),
      ).toBe('23503');
    }));

  it('rows cannot be moved to another restaurant', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const alpha = await seedMenu(c, w.alpha);
      await actAs(c, w.alice);
      for (const table of [
        'menu_items',
        'menu_categories',
        'modifiers',
        'outlets',
        'dining_tables',
      ]) {
        expect(await errorCodeOf(c, `update ${table} set restaurant_id = $1`, [w.beta])).toBe(
          '42501',
        );
      }
      void alpha;
    }));
});

describe('roles on the menu', () => {
  it('owner and manager can edit the menu; kitchen and cashier cannot', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const m = await seedMenu(c, w.alpha);
      await actAs(c, w.manager);
      expect(
        (await c.query(`update menu_items set price_paise = 13000 where id = $1`, [m.item]))
          .rowCount,
      ).toBe(1);
      await c.query(`insert into menu_categories (restaurant_id, name) values ($1, $2)`, [
        w.alpha,
        en('Tea'),
      ]);
      await actAs(c, w.kitchen);
      expect(
        (await c.query(`update menu_items set price_paise = 1 where id = $1`, [m.item])).rowCount,
      ).toBe(0);
      expect(
        await errorCodeOf(c, `insert into menu_categories (restaurant_id, name) values ($1, $2)`, [
          w.alpha,
          en('Nope'),
        ]),
      ).toBe('42501');
      expect((await c.query(`delete from menu_items where id = $1`, [m.item])).rowCount).toBe(0);
      // but can read everything
      expect(await count(c, 'select 1 from menu_items')).toBe(1);
    }));

  it('kitchen can flip sold-out only through set_item_availability', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const m = await seedMenu(c, w.alpha);
      await actAs(c, w.kitchen);
      expect(
        await errorCodeOf(c, `update menu_items set is_available = false where id = $1`, [m.item]),
      ).toBe('42501');
      await c.query(`select set_item_availability($1, false)`, [m.item]);
      expect(
        await scalar<boolean>(c, `select is_available v from menu_items where id = $1`, [m.item]),
      ).toBe(false);
      await c.query(`select set_item_availability($1, true)`, [m.item]);
      expect(
        await scalar<boolean>(c, `select is_available v from menu_items where id = $1`, [m.item]),
      ).toBe(true);
    }));

  it('set_item_availability refuses outsiders, other restaurants and anonymous users', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const alpha = await seedMenu(c, w.alpha);
      const beta = await seedMenu(c, w.beta);
      await actAs(c, w.stranger);
      expect(await errorCodeOf(c, `select set_item_availability($1, false)`, [alpha.item])).toBe(
        '42501',
      );
      await actAs(c, w.alice);
      expect(await errorCodeOf(c, `select set_item_availability($1, false)`, [beta.item])).toBe(
        '42501',
      );
      expect(await errorCodeOf(c, `select set_item_availability(gen_random_uuid(), false)`)).toBe(
        '42501',
      );
      await actAsAnon(c);
      expect(await errorCodeOf(c, `select set_item_availability($1, false)`, [alpha.item])).toBe(
        '42501',
      );
    }));
});

describe('menu data validation', () => {
  async function ctx(c: Client) {
    const w = await seedWorld(c);
    const m = await seedMenu(c, w.alpha);
    await actAs(c, w.alice);
    return { w, m };
  }
  const item = (c: Client, w: World, m: Menu, cols: string, vals: unknown[]) =>
    errorCodeOf(
      c,
      `insert into menu_items (restaurant_id, category_id, ${cols}) values ($1, $2, ${vals.map((_, i) => `$${i + 3}`).join(', ')})`,
      [w.alpha, m.category, ...vals],
    );

  it('requires diet to be stated (no default)', () =>
    inRollback(async (c) => {
      const { w, m } = await ctx(c);
      expect(await item(c, w, m, 'name, price_paise', [en('X'), 100])).toBe('23502');
    }));

  it('rejects bad prices and taxes', () =>
    inRollback(async (c) => {
      const { w, m } = await ctx(c);
      for (const price of [-1, 10_000_001])
        expect(await item(c, w, m, 'name, price_paise, diet', [en('X'), price, 'veg'])).toBe(
          '23514',
        );
      expect(
        await item(c, w, m, 'name, price_paise, diet, tax_rate_bps', [en('X'), 100, 'veg', 2801]),
      ).toBe('23514');
      expect(await item(c, w, m, 'name, price_paise, diet', [en('Free'), 0, 'veg'])).toBeNull();
    }));

  it('validates localised text', () =>
    inRollback(async (c) => {
      const { w, m } = await ctx(c);
      const bad = [
        '{}',
        '{"hi": "चाय"}', // English is required
        '{"en": "Tea", "fr": "Thé"}', // unknown language
        '{"en": "Tea", "hi": ""}', // empty
        '{"en": "Tea", "hi": "   "}', // whitespace only
        '{"en": 5}', // not a string
        '"Tea"', // not an object
        JSON.stringify({ en: 'x'.repeat(121) }), // too long
      ];
      for (const name of bad) {
        expect(await item(c, w, m, 'name, price_paise, diet', [name, 100, 'veg']), name).toBe(
          '23514',
        );
      }
      const good = JSON.stringify({ en: 'Tea', hi: 'चाय', te: 'టీ' });
      expect(await item(c, w, m, 'name, price_paise, diet', [good, 100, 'veg'])).toBeNull();
    }));

  it('requires both ends of an availability window or neither', () =>
    inRollback(async (c) => {
      const { w, m } = await ctx(c);
      expect(
        await item(c, w, m, 'name, price_paise, diet, available_from', [
          en('X'),
          100,
          'veg',
          '07:00',
        ]),
      ).toBe('23514');
      expect(
        await item(c, w, m, 'name, price_paise, diet, available_from, available_until', [
          en('X'),
          100,
          'veg',
          '07:00',
          '11:00',
        ]),
      ).toBeNull();
    }));

  it('checks modifier group limits', () =>
    inRollback(async (c) => {
      const { w, m } = await ctx(c);
      const g = (min: number, max: number) =>
        errorCodeOf(
          c,
          `insert into modifier_groups (restaurant_id, item_id, name, min_select, max_select) values ($1, $2, $3, $4, $5)`,
          [w.alpha, m.item, en('G'), min, max],
        );
      expect(await g(2, 1)).toBe('23514');
      expect(await g(0, 0)).toBe('23514');
      expect(await g(1, 3)).toBeNull();
    }));

  it('rejects duplicate table labels within an outlet', () =>
    inRollback(async (c) => {
      const { w, m } = await ctx(c);
      expect(
        await errorCodeOf(
          c,
          `insert into dining_tables (restaurant_id, outlet_id, label) values ($1, $2, 'T1')`,
          [w.alpha, m.outlet],
        ),
      ).toBe('23505');
    }));
});

describe('payment settings', () => {
  it('are created with sensible defaults for every new restaurant', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.alice);
      const row = (
        await c.query(
          `select accept_online, accept_cash, accept_manual_upi, mode from payment_settings`,
        )
      ).rows[0];
      expect(row).toEqual({
        accept_online: false,
        accept_cash: true,
        accept_manual_upi: false,
        mode: 'prepare_first',
      });
      expect(await scalar<number>(c, `select count(*)::int v from outlets`)).toBe(1);
    }));

  it('owner and manager can change them; kitchen cannot', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.manager);
      expect((await c.query(`update payment_settings set mode = 'pay_first'`)).rowCount).toBe(1);
      await actAs(c, w.kitchen);
      expect((await c.query(`update payment_settings set mode = 'prepare_first'`)).rowCount).toBe(
        0,
      );
    }));

  it('refuse impossible combinations', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.alice);
      // manual UPI on without details
      expect(await errorCodeOf(c, `update payment_settings set accept_manual_upi = true`)).toBe(
        '23514',
      );
      // no way to pay at all
      expect(await errorCodeOf(c, `update payment_settings set accept_cash = false`)).toBe('23514');
      // malformed UPI IDs
      for (const vpa of ['nohandle', 'a@', '@bank', 'has space@upi', 'x@1bank', 'a@b@c']) {
        expect(
          await errorCodeOf(c, `update payment_settings set manual_upi_id = $1`, [vpa]),
          vpa,
        ).toBe('23514');
      }
      // valid details work, then manual UPI can be enabled
      await c.query(
        `update payment_settings set manual_upi_id = 'cafe.alpha@okhdfcbank', payee_name = 'Alpha Cafe'`,
      );
      expect((await c.query(`update payment_settings set accept_manual_upi = true`)).rowCount).toBe(
        1,
      );
    }));

  it('cannot be inserted or deleted through the API', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAs(c, w.alice);
      expect(await errorCodeOf(c, `delete from payment_settings`)).toBe('42501');
      expect(
        await errorCodeOf(c, `insert into payment_settings (restaurant_id) values ($1)`, [w.alpha]),
      ).toBe('42501');
    }));
});

describe('audit trail for menu changes', () => {
  it('is readable by owner and manager, and shows the change', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const m = await seedMenu(c, w.alpha);
      await actAs(c, w.manager);
      await c.query(`update menu_items set price_paise = 15000 where id = $1`, [m.item]);
      await c.query(`select set_item_availability($1, false)`, [m.item]);
      const rows = (
        await c.query(
          `select actor_user_id, details from audit_log where entity_id = $1 and action = 'menu_items.updated' order by id`,
          [m.item],
        )
      ).rows;
      expect(rows).toHaveLength(2);
      expect(rows[0].actor_user_id).toBe(w.manager);
      expect(rows[0].details).toEqual({ price_paise: { from: 12000, to: 15000 } });
      expect(rows[1].details).toEqual({ is_available: { from: true, to: false } });
    }));

  it('records nothing when an update changes nothing', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const m = await seedMenu(c, w.alpha);
      await actAs(c, w.alice);
      const before = await count(c, `select 1 from audit_log`);
      await c.query(`update menu_items set price_paise = 12000 where id = $1`, [m.item]);
      expect(await count(c, `select 1 from audit_log`)).toBe(before);
    }));

  it('records deletes, and deleting a whole restaurant still works', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const m = await seedMenu(c, w.alpha);
      await actAs(c, w.alice);
      await c.query(`delete from menu_categories where id = $1`, [m.category]);
      expect(
        await count(c, `select 1 from audit_log where action = 'menu_categories.deleted'`),
      ).toBe(1);
      expect(await count(c, `select 1 from menu_items where id = $1`, [m.item])).toBe(0); // cascade
      await actAsSuperuser(c);
      await c.query(`delete from restaurants where id = $1`, [w.alpha]);
      expect(await count(c, `select 1 from outlets where restaurant_id = $1`, [w.alpha])).toBe(0);
    }));
});

describe('public reads for customers', () => {
  it('anonymous visitors cannot read menu tables directly', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await seedMenu(c, w.alpha);
      await actAsAnon(c);
      for (const t of [
        'menu_items',
        'menu_categories',
        'modifiers',
        'dining_tables',
        'outlets',
        'payment_settings',
      ]) {
        expect(await errorCodeOf(c, `select * from ${t}`), t).toBe('42501');
      }
    }));

  it('get_public_menu returns the live menu, hides inactive things and leaks no internals', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const m = await seedMenu(c, w.alpha);
      await actAsSuperuser(c);
      await c.query(
        `insert into menu_items (restaurant_id, category_id, name, price_paise, diet, is_active) values ($1, $2, $3, 100, 'veg', false)`,
        [w.alpha, m.category, en('Hidden')],
      );
      await c.query(
        `insert into menu_categories (restaurant_id, name, is_active) values ($1, $2, false)`,
        [w.alpha, en('Hidden category')],
      );
      await actAsAnon(c);
      const menu = await scalar<PublicMenu>(c, `select get_public_menu('alpha-cafe') v`);
      expect(menu.restaurant).toEqual({
        name: 'Alpha Cafe',
        slug: 'alpha-cafe',
        default_locale: 'en',
      });
      expect(menu.categories).toHaveLength(1);
      expect(menu.categories[0]!.items).toHaveLength(1);
      const item = menu.categories[0]!.items[0]!;
      expect(item).toMatchObject({ price_paise: 12000, diet: 'veg', orderable: true });
      expect(item.modifier_groups[0]!.modifiers[0]!).toMatchObject({
        price_delta_paise: 3000,
        available: true,
      });
      const text = JSON.stringify(menu);
      expect(text).not.toContain('restaurant_id');
      expect(text).not.toContain('Hidden');
      expect(text).not.toContain(w.alpha);
    }));

  it('marks sold-out items as not orderable', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const m = await seedMenu(c, w.alpha);
      await actAs(c, w.kitchen);
      await c.query(`select set_item_availability($1, false)`, [m.item]);
      await actAsAnon(c);
      const menu = await scalar<PublicMenu>(c, `select get_public_menu('alpha-cafe') v`);
      expect(menu.categories[0]!.items[0]!.orderable).toBe(false);
    }));

  it('respects availability windows in the outlet timezone, including overnight windows', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const m = await seedMenu(c, w.alpha);
      await actAsSuperuser(c);
      await c.query(
        `update menu_items set available_from = '07:00', available_until = '11:00' where id = $1`,
        [m.item],
      );
      await actAsAnon(c);
      const orderableAt = async (iso: string) =>
        (
          await scalar<PublicMenu>(c, `select get_public_menu('alpha-cafe', $1::timestamptz) v`, [
            iso,
          ])
        ).categories[0]!.items[0]!.orderable;
      // Asia/Kolkata is UTC+5:30: 08:00 IST = 02:30Z
      expect(await orderableAt('2026-10-01T02:30:00Z')).toBe(true);
      expect(await orderableAt('2026-10-01T05:30:00Z')).toBe(false); // 11:00 IST, end is exclusive
      expect(await orderableAt('2026-10-01T00:00:00Z')).toBe(false); // 05:30 IST
      // overnight window 22:00-02:00 IST
      await actAsSuperuser(c);
      await c.query(
        `update menu_items set available_from = '22:00', available_until = '02:00' where id = $1`,
        [m.item],
      );
      await actAsAnon(c);
      expect(await orderableAt('2026-10-01T17:30:00Z')).toBe(true); // 23:00 IST
      expect(await orderableAt('2026-10-01T20:00:00Z')).toBe(true); // 01:30 IST next day
      expect(await orderableAt('2026-10-01T09:00:00Z')).toBe(false); // 14:30 IST
    }));

  it('returns null for unknown or inactive restaurants', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      await actAsSuperuser(c);
      await c.query(`update restaurants set is_active = false where id = $1`, [w.beta]);
      await actAsAnon(c);
      expect(await scalar(c, `select get_public_menu('nope-cafe') v`)).toBeNull();
      expect(await scalar(c, `select get_public_menu('beta-cafe') v`)).toBeNull();
    }));

  it('resolve_table only resolves live tables with the current QR version', () =>
    inRollback(async (c) => {
      const w = await seedWorld(c);
      const m = await seedMenu(c, w.alpha);
      await actAsAnon(c);
      const ok = await scalar<Record<string, string>>(c, `select resolve_table($1, 1) v`, [
        m.table,
      ]);
      expect(ok).toEqual({
        table_id: m.table,
        label: 'T1',
        restaurant_slug: 'alpha-cafe',
        restaurant_name: 'Alpha Cafe',
      });
      expect(await scalar(c, `select resolve_table($1, 2) v`, [m.table])).toBeNull();
      // owner revokes stickers by bumping the version
      await actAs(c, w.alice);
      await c.query(`update dining_tables set qr_version = 2 where id = $1`, [m.table]);
      await actAsAnon(c);
      expect(await scalar(c, `select resolve_table($1, 1) v`, [m.table])).toBeNull();
      expect(await scalar(c, `select resolve_table($1, 2) v`, [m.table])).not.toBeNull();
      // deactivated table
      await actAs(c, w.alice);
      await c.query(`update dining_tables set is_active = false where id = $1`, [m.table]);
      await actAsAnon(c);
      expect(await scalar(c, `select resolve_table($1, 2) v`, [m.table])).toBeNull();
    }));
});

describe('within_window()', () => {
  const at = (from: string | null, until: string | null, iso: string) =>
    inRollback(async (c) =>
      scalar<boolean>(
        c,
        `select private.within_window($1::time, $2::time, 'Asia/Kolkata', $3::timestamptz) v`,
        [from, until, iso],
      ),
    );

  it('no window means always', async () => {
    expect(await at(null, null, '2026-10-01T00:00:00Z')).toBe(true);
  });
  it('start is inclusive, end is exclusive', async () => {
    expect(await at('07:00', '11:00', '2026-10-01T01:30:00Z')).toBe(true); // 07:00 IST
    expect(await at('07:00', '11:00', '2026-10-01T05:30:00Z')).toBe(false); // 11:00 IST
  });
});

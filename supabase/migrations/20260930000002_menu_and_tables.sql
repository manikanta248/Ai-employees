-- Phase 2a: outlets, dining tables, menu (categories, items, modifiers), payment settings,
-- public read functions, and audit triggers. Same rules as the tenancy base: every table carries
-- restaurant_id, has RLS enabled and forced, and anonymous users touch nothing directly.

-- ---------------------------------------------------------------------------------------------
-- Types and validators
-- ---------------------------------------------------------------------------------------------
-- Owners must state this explicitly for every item. There is deliberately no default: a wrong
-- veg/non-veg label is a legal and religious problem, so we never guess.
create type public.diet_type as enum ('veg', 'non_veg', 'egg');
create type public.payment_mode as enum ('prepare_first', 'pay_first');

-- Localised text: {"en": "...", "hi": "...", "te": "..."}. English is required (it is the fallback),
-- other keys are optional, unknown keys are rejected, values are non-empty and length-bounded.
create function private.valid_i18n(j jsonb, max_len int, require_en boolean default true)
returns boolean language sql immutable as $$
  select
    j is not null
    and jsonb_typeof(j) = 'object'
    and (not require_en or (j ? 'en'))
    and not exists (
      select 1 from jsonb_each(j) e
      where e.key not in ('en', 'hi', 'te')
         or jsonb_typeof(e.value) <> 'string'
         or char_length(btrim(e.value #>> '{}')) not between 1 and max_len
    );
$$;
grant execute on function private.valid_i18n(jsonb, int, boolean) to authenticated, anon;

-- Is `at_time` inside the [from, until) daily window in timezone `tz`? Windows may cross midnight.
-- A null window means "always".
create function private.within_window(from_t time, until_t time, tz text, at_time timestamptz default now())
returns boolean language sql stable as $$
  select case
    when from_t is null or until_t is null then true
    when from_t <= until_t then (at_time at time zone tz)::time >= from_t and (at_time at time zone tz)::time < until_t
    else (at_time at time zone tz)::time >= from_t or (at_time at time zone tz)::time < until_t
  end;
$$;
grant execute on function private.within_window(time, time, text, timestamptz) to authenticated, anon;

-- ---------------------------------------------------------------------------------------------
-- outlets and dining tables
-- ---------------------------------------------------------------------------------------------
create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  address text check (address is null or char_length(address) <= 400),
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id)
);
create index outlets_restaurant_idx on public.outlets (restaurant_id);
create trigger outlets_updated_at before update on public.outlets
  for each row execute function private.set_updated_at();

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  outlet_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 30),
  -- Bumping this invalidates every QR sticker printed for the table (lost, stolen, or misused).
  qr_version int not null default 1 check (qr_version >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  unique (outlet_id, label),
  -- The composite key makes it impossible to attach a table to another restaurant's outlet.
  foreign key (outlet_id, restaurant_id) references public.outlets (id, restaurant_id) on delete cascade
);
create index dining_tables_restaurant_idx on public.dining_tables (restaurant_id);
create trigger dining_tables_updated_at before update on public.dining_tables
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- menu
-- ---------------------------------------------------------------------------------------------
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name jsonb not null check (private.valid_i18n(name, 80)),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id)
);
create index menu_categories_restaurant_idx on public.menu_categories (restaurant_id, sort_order);
create trigger menu_categories_updated_at before update on public.menu_categories
  for each row execute function private.set_updated_at();

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id uuid not null,
  name jsonb not null check (private.valid_i18n(name, 120)),
  description jsonb check (description is null or private.valid_i18n(description, 500)),
  price_paise int not null check (price_paise between 0 and 10000000),
  -- GST etc. in basis points (500 = 5%). Capped at 28%.
  tax_rate_bps int not null default 500 check (tax_rate_bps between 0 and 2800),
  diet public.diet_type not null,
  image_path text check (image_path is null or char_length(image_path) <= 300),
  -- The sold-out switch. Kitchen and cashier can flip only this, via set_item_availability().
  is_available boolean not null default true,
  available_from time,
  available_until time,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  check ((available_from is null) = (available_until is null)),
  foreign key (category_id, restaurant_id) references public.menu_categories (id, restaurant_id) on delete cascade
);
create index menu_items_category_idx on public.menu_items (restaurant_id, category_id, sort_order);
create trigger menu_items_updated_at before update on public.menu_items
  for each row execute function private.set_updated_at();

create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id uuid not null,
  name jsonb not null check (private.valid_i18n(name, 80)),
  min_select int not null default 0 check (min_select >= 0),
  max_select int not null default 1 check (max_select >= 1),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  check (max_select >= min_select),
  foreign key (item_id, restaurant_id) references public.menu_items (id, restaurant_id) on delete cascade
);
create index modifier_groups_item_idx on public.modifier_groups (restaurant_id, item_id, sort_order);
create trigger modifier_groups_updated_at before update on public.modifier_groups
  for each row execute function private.set_updated_at();

create table public.modifiers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  group_id uuid not null,
  name jsonb not null check (private.valid_i18n(name, 80)),
  price_delta_paise int not null default 0 check (price_delta_paise between 0 and 10000000),
  is_available boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (group_id, restaurant_id) references public.modifier_groups (id, restaurant_id) on delete cascade
);
create index modifiers_group_idx on public.modifiers (restaurant_id, group_id, sort_order);
create trigger modifiers_updated_at before update on public.modifiers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- payment settings (one row per restaurant). Payment processing itself arrives in Phase 4.
-- ---------------------------------------------------------------------------------------------
create table public.payment_settings (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  accept_online boolean not null default false,
  accept_cash boolean not null default true,
  accept_card_at_counter boolean not null default false,
  accept_manual_upi boolean not null default false,
  mode public.payment_mode not null default 'prepare_first',
  manual_upi_id text check (manual_upi_id is null or manual_upi_id ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z][a-zA-Z0-9]{1,64}$'),
  payee_name text check (payee_name is null or char_length(btrim(payee_name)) between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Manual UPI cannot be switched on without the details it needs.
  check (not accept_manual_upi or (manual_upi_id is not null and payee_name is not null)),
  -- At least one way to pay must exist.
  check (accept_online or accept_cash or accept_card_at_counter or accept_manual_upi)
);
create trigger payment_settings_updated_at before update on public.payment_settings
  for each row execute function private.set_updated_at();

-- Every restaurant starts with a Main outlet and default payment settings.
create or replace function public.create_restaurant(p_name text, p_slug text, p_locale public.locale_code default 'en')
returns public.restaurants
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  r public.restaurants;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  insert into public.restaurants (name, slug, default_locale)
    values (btrim(p_name), p_slug, p_locale)
    returning * into r;
  perform private.write_audit(r.id, 'restaurant.created', 'restaurants', r.id,
    jsonb_build_object('slug', r.slug));
  insert into public.staff_members (restaurant_id, user_id, role) values (r.id, uid, 'owner');
  insert into public.outlets (restaurant_id, name) values (r.id, 'Main');
  insert into public.payment_settings (restaurant_id) values (r.id);
  return r;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Audit trail for every change to menu, tables, outlets and payment settings
-- ---------------------------------------------------------------------------------------------
create function private.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rid uuid;
  eid uuid;
  d jsonb;
  action text;
begin
  rid := coalesce((to_jsonb(new) ->> 'restaurant_id'), (to_jsonb(old) ->> 'restaurant_id'))::uuid;
  eid := coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'))::uuid;

  if tg_op = 'DELETE' then
    -- If the whole restaurant is being deleted its audit trail goes with it; nothing to record.
    if not exists (select 1 from public.restaurants r where r.id = rid) then
      return old;
    end if;
    action := tg_table_name || '.deleted';
    d := jsonb_build_object('name', to_jsonb(old) -> 'name');
  elsif tg_op = 'INSERT' then
    action := tg_table_name || '.created';
    d := jsonb_build_object('name', to_jsonb(new) -> 'name');
  else
    action := tg_table_name || '.updated';
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', to_jsonb(old) -> n.key, 'to', n.value)), '{}'::jsonb)
      into d
      from jsonb_each(to_jsonb(new)) n
      where n.key <> 'updated_at' and (to_jsonb(old) -> n.key) is distinct from n.value;
    if d = '{}'::jsonb then
      return new;
    end if;
  end if;

  perform private.write_audit(rid, action, tg_table_name, eid, d);
  return coalesce(new, old);
end;
$$;

create trigger outlets_audit after insert or update or delete on public.outlets
  for each row execute function private.audit_row_change();
create trigger dining_tables_audit after insert or update or delete on public.dining_tables
  for each row execute function private.audit_row_change();
create trigger menu_categories_audit after insert or update or delete on public.menu_categories
  for each row execute function private.audit_row_change();
create trigger menu_items_audit after insert or update or delete on public.menu_items
  for each row execute function private.audit_row_change();
create trigger modifier_groups_audit after insert or update or delete on public.modifier_groups
  for each row execute function private.audit_row_change();
create trigger modifiers_audit after insert or update or delete on public.modifiers
  for each row execute function private.audit_row_change();
create trigger payment_settings_audit after update on public.payment_settings
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['outlets', 'dining_tables', 'menu_categories', 'menu_items',
                           'modifier_groups', 'modifiers', 'payment_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, public, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_member(restaurant_id))',
      t || '_select_members', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (private.has_role(restaurant_id, array[''owner'', ''manager'']::public.staff_role[]))
         with check (private.has_role(restaurant_id, array[''owner'', ''manager'']::public.staff_role[]))',
      t || '_update_owner_manager', t);
    -- payment_settings rows are created only by create_restaurant(), never inserted or deleted.
    if t <> 'payment_settings' then
      execute format('grant insert, delete on public.%I to authenticated', t);
      execute format(
        'create policy %I on public.%I for insert to authenticated
           with check (private.has_role(restaurant_id, array[''owner'', ''manager'']::public.staff_role[]))',
        t || '_insert_owner_manager', t);
      execute format(
        'create policy %I on public.%I for delete to authenticated
           using (private.has_role(restaurant_id, array[''owner'', ''manager'']::public.staff_role[]))',
        t || '_delete_owner_manager', t);
    end if;
  end loop;
end $$;

-- Insert grants name restaurant_id (needed) but updates never may: rows cannot change tenant.
-- Column grants for insert and update, per table.
grant insert (restaurant_id, name, address, timezone, is_active) on public.outlets to authenticated;
grant update (name, address, timezone, is_active) on public.outlets to authenticated;

grant insert (restaurant_id, outlet_id, label, is_active) on public.dining_tables to authenticated;
grant update (label, qr_version, is_active) on public.dining_tables to authenticated;

grant insert (restaurant_id, name, sort_order, is_active) on public.menu_categories to authenticated;
grant update (name, sort_order, is_active) on public.menu_categories to authenticated;

grant insert (restaurant_id, category_id, name, description, price_paise, tax_rate_bps, diet, image_path,
              available_from, available_until, sort_order, is_active) on public.menu_items to authenticated;
-- is_available (the sold-out switch) is not directly updatable: use set_item_availability().
grant update (category_id, name, description, price_paise, tax_rate_bps, diet, image_path,
              available_from, available_until, sort_order, is_active) on public.menu_items to authenticated;

grant insert (restaurant_id, item_id, name, min_select, max_select, sort_order) on public.modifier_groups to authenticated;
grant update (name, min_select, max_select, sort_order) on public.modifier_groups to authenticated;

grant insert (restaurant_id, group_id, name, price_delta_paise, is_available, sort_order) on public.modifiers to authenticated;
grant update (name, price_delta_paise, is_available, sort_order) on public.modifiers to authenticated;

grant update (accept_online, accept_cash, accept_card_at_counter, accept_manual_upi, mode,
              manual_upi_id, payee_name) on public.payment_settings to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Sold-out switch: any staff member (including kitchen and cashier) may flip it, nothing else.
-- ---------------------------------------------------------------------------------------------
create function public.set_item_availability(p_item_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rid uuid;
begin
  select restaurant_id into rid from public.menu_items where id = p_item_id;
  if rid is null or not private.is_member(rid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.menu_items set is_available = p_available where id = p_item_id;
end;
$$;
revoke all on function public.set_item_availability(uuid, boolean) from public, anon;
grant execute on function public.set_item_availability(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Public (anonymous) reads. Customers never touch tables: they call these two functions, which
-- return only what a customer may see.
-- ---------------------------------------------------------------------------------------------
create function public.get_public_menu(p_slug text, p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  tz text;
  result jsonb;
begin
  select * into r from public.restaurants where slug = p_slug and is_active;
  if not found then
    return null;
  end if;
  select o.timezone into tz from public.outlets o
    where o.restaurant_id = r.id and o.is_active order by o.created_at limit 1;
  tz := coalesce(tz, 'Asia/Kolkata');

  select jsonb_build_object(
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'default_locale', r.default_locale),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id,
            'name', i.name,
            'description', i.description,
            'price_paise', i.price_paise,
            'tax_rate_bps', i.tax_rate_bps,
            'diet', i.diet,
            'image_path', i.image_path,
            'orderable', i.is_available and private.within_window(i.available_from, i.available_until, tz, p_at),
            'modifier_groups', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', g.id,
                'name', g.name,
                'min_select', g.min_select,
                'max_select', g.max_select,
                'modifiers', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', m.id, 'name', m.name,
                    'price_delta_paise', m.price_delta_paise, 'available', m.is_available
                  ) order by m.sort_order, m.created_at)
                  from public.modifiers m where m.group_id = g.id and m.restaurant_id = r.id
                ), '[]'::jsonb)
              ) order by g.sort_order, g.created_at)
              from public.modifier_groups g where g.item_id = i.id and g.restaurant_id = r.id
            ), '[]'::jsonb)
          ) order by i.sort_order, i.created_at)
          from public.menu_items i
          where i.category_id = c.id and i.restaurant_id = r.id and i.is_active
        ), '[]'::jsonb)
      ) order by c.sort_order, c.created_at)
      from public.menu_categories c where c.restaurant_id = r.id and c.is_active
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_public_menu(text, timestamptz) from public;
grant execute on function public.get_public_menu(text, timestamptz) to anon, authenticated;

-- The application verifies the QR signature, then asks which table it points to. Returns nothing
-- if the table is inactive, deleted, or the sticker's version was revoked.
create function public.resolve_table(p_table_id uuid, p_version int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'table_id', t.id, 'label', t.label, 'restaurant_slug', r.slug, 'restaurant_name', r.name)
  from public.dining_tables t
  join public.restaurants r on r.id = t.restaurant_id
  where t.id = p_table_id and t.qr_version = p_version and t.is_active and r.is_active;
$$;
revoke all on function public.resolve_table(uuid, int) from public;
grant execute on function public.resolve_table(uuid, int) to anon, authenticated;

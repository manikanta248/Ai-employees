-- Phase 1: tenancy base. Every business table carries restaurant_id, has RLS enabled and forced,
-- and is denied by default. Access is granted only through explicit policies below.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.staff_role as enum ('owner', 'manager', 'kitchen', 'cashier');
create type public.locale_code as enum ('en', 'hi', 'te');

-- ---------------------------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------------------------------
create function private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- restaurants
-- ---------------------------------------------------------------------------------------------
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  default_locale public.locale_code not null default 'en',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger restaurants_updated_at before update on public.restaurants
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- staff_members: who can act for a restaurant, and as what
-- ---------------------------------------------------------------------------------------------
create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.staff_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, user_id)
);
create index staff_members_user_id_idx on public.staff_members (user_id);
create trigger staff_members_updated_at before update on public.staff_members
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- audit_log: append-only record of staff actions
-- ---------------------------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  actor_user_id uuid,
  action text not null check (char_length(action) between 1 and 80),
  entity_table text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_restaurant_created_idx on public.audit_log (restaurant_id, created_at desc);

create function private.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  -- The only permitted removal is the cascade from deleting the whole restaurant, at which point
  -- the parent row is already gone. Editing, or deleting while the restaurant exists, is refused.
  if tg_op = 'DELETE' and not exists (select 1 from public.restaurants r where r.id = old.restaurant_id) then
    return old;
  end if;
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();

-- ---------------------------------------------------------------------------------------------
-- RLS helper functions. SECURITY DEFINER so policies can read staff_members without recursion.
-- They live in the private schema and are never exposed through the API.
-- ---------------------------------------------------------------------------------------------
create function private.is_member(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members s
    where s.restaurant_id = rid and s.user_id = (select auth.uid())
  );
$$;

create function private.has_role(rid uuid, roles public.staff_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members s
    where s.restaurant_id = rid and s.user_id = (select auth.uid()) and s.role = any (roles)
  );
$$;

revoke all on function private.is_member(uuid) from public;
revoke all on function private.has_role(uuid, public.staff_role[]) from public;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, public.staff_role[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Guard: a restaurant can never be left without an owner
-- ---------------------------------------------------------------------------------------------
create function private.keep_one_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  remaining int;
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    -- When the whole restaurant is being deleted, cascades are allowed.
    if not exists (select 1 from public.restaurants r where r.id = old.restaurant_id) then
      return coalesce(new, old);
    end if;
    select count(*) into remaining from public.staff_members s
      where s.restaurant_id = old.restaurant_id and s.role = 'owner' and s.id <> old.id;
    if remaining = 0 then
      raise exception 'a restaurant must keep at least one owner' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger staff_members_keep_one_owner before update or delete on public.staff_members
  for each row execute function private.keep_one_owner();

-- Prevent moving a staff row to another restaurant or another user.
create function private.staff_members_immutable_keys() returns trigger
language plpgsql as $$
begin
  if new.restaurant_id <> old.restaurant_id or new.user_id <> old.user_id then
    raise exception 'restaurant_id and user_id cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger staff_members_keys_immutable before update on public.staff_members
  for each row execute function private.staff_members_immutable_keys();

-- ---------------------------------------------------------------------------------------------
-- Row level security: enabled and forced, deny by default
-- ---------------------------------------------------------------------------------------------
alter table public.restaurants enable row level security;
alter table public.restaurants force row level security;
alter table public.staff_members enable row level security;
alter table public.staff_members force row level security;
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

-- Nothing for anonymous users, ever, on these tables.
revoke all on public.restaurants, public.staff_members, public.audit_log from anon, public;

-- Signed-in users get the least privilege each table needs.
revoke all on public.restaurants, public.staff_members, public.audit_log from authenticated;
grant select on public.restaurants to authenticated;
grant update (name, default_locale, is_active) on public.restaurants to authenticated;
grant select on public.staff_members to authenticated;
grant insert (restaurant_id, user_id, role) on public.staff_members to authenticated;
grant update (role) on public.staff_members to authenticated;
grant delete on public.staff_members to authenticated;
grant select on public.audit_log to authenticated;

-- restaurants
create policy restaurants_select_members on public.restaurants
  for select to authenticated using (private.is_member(id));
create policy restaurants_update_owner_manager on public.restaurants
  for update to authenticated
  using (private.has_role(id, array['owner', 'manager']::public.staff_role[]))
  with check (private.has_role(id, array['owner', 'manager']::public.staff_role[]));

-- staff_members
create policy staff_select_same_restaurant on public.staff_members
  for select to authenticated using (private.is_member(restaurant_id));
create policy staff_insert_owner on public.staff_members
  for insert to authenticated
  with check (private.has_role(restaurant_id, array['owner']::public.staff_role[]));
create policy staff_update_owner on public.staff_members
  for update to authenticated
  using (private.has_role(restaurant_id, array['owner']::public.staff_role[]))
  with check (private.has_role(restaurant_id, array['owner']::public.staff_role[]));
create policy staff_delete_owner on public.staff_members
  for delete to authenticated
  using (private.has_role(restaurant_id, array['owner']::public.staff_role[]));

-- audit_log: owners and managers can read. Nobody inserts directly; use private.write_audit().
create policy audit_select_owner_manager on public.audit_log
  for select to authenticated
  using (private.has_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));

-- ---------------------------------------------------------------------------------------------
-- Controlled write paths
-- ---------------------------------------------------------------------------------------------
create function private.write_audit(
  rid uuid, action text, entity_table text, entity_id uuid, details jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (restaurant_id, actor_user_id, action, entity_table, entity_id, details)
  values (rid, (select auth.uid()), action, entity_table, entity_id, coalesce(details, '{}'::jsonb));
$$;
revoke all on function private.write_audit(uuid, text, text, uuid, jsonb) from public;

-- Sign-up flow: create a restaurant and make the caller its owner, atomically.
create function public.create_restaurant(p_name text, p_slug text, p_locale public.locale_code default 'en')
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
  return r;
end;
$$;
revoke all on function public.create_restaurant(text, text, public.locale_code) from public, anon;
grant execute on function public.create_restaurant(text, text, public.locale_code) to authenticated;

-- Staff changes are recorded automatically.
create function private.audit_staff_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.restaurant_id, 'staff.added', 'staff_members', new.id,
      jsonb_build_object('user_id', new.user_id, 'role', new.role));
  elsif tg_op = 'UPDATE' and new.role <> old.role then
    perform private.write_audit(new.restaurant_id, 'staff.role_changed', 'staff_members', new.id,
      jsonb_build_object('user_id', new.user_id, 'from', old.role, 'to', new.role));
  elsif tg_op = 'DELETE' then
    -- Skip when the restaurant itself is being deleted (its audit rows go with it).
    if exists (select 1 from public.restaurants r where r.id = old.restaurant_id) then
      perform private.write_audit(old.restaurant_id, 'staff.removed', 'staff_members', old.id,
        jsonb_build_object('user_id', old.user_id, 'role', old.role));
    end if;
    return old;
  end if;
  return new;
end;
$$;
create trigger staff_members_audit after insert or update or delete on public.staff_members
  for each row execute function private.audit_staff_change();

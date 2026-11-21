-- Apply after 20261117120000_platform_switchboard.sql as postgres.
-- Existing profile roles are preserved. No user is promoted automatically.
begin;

alter table public.profiles add column if not exists role text default 'executive';

create or replace function public.is_super_admin_role(p_role text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(regexp_replace(upper(btrim(p_role)), '[[:space:]-]+', '_', 'g') = 'SUPER_ADMIN', false);
$$;

create or replace function public.is_platform_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (select 1 from public.profiles p where p.id = auth.uid() and public.is_super_admin_role(p.role::text))
    or exists (select 1 from public.company_users m where m.user_id = auth.uid() and public.is_super_admin_role(m.role::text))
  );
$$;
alter function public.is_platform_super_admin() owner to postgres;
revoke all on function public.is_platform_super_admin() from public, anon;
grant execute on function public.is_platform_super_admin() to authenticated;

-- A profile may be editable by its owner, but its platform role must not be.
create or replace function public.protect_profile_platform_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      if public.is_super_admin_role(new.role::text) then
        raise exception 'Platform roles must be assigned by a database administrator';
      end if;
    elsif public.is_super_admin_role(new.role::text) or public.is_super_admin_role(old.role::text) then
      if new.role is distinct from old.role or new.id is distinct from old.id then
        raise exception 'Platform roles must be changed by a database administrator';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_platform_role on public.profiles;
create trigger protect_profile_platform_role before insert or update on public.profiles
for each row execute function public.protect_profile_platform_role();

-- Protect every recognized spelling for existing membership-based platform roles.
create or replace function public.protect_platform_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      if public.is_super_admin_role(new.role::text) then
        raise exception 'Platform roles must be assigned by a database administrator';
      end if;
    elsif public.is_super_admin_role(new.role::text) or public.is_super_admin_role(old.role::text) then
      if new.role is distinct from old.role or new.user_id is distinct from old.user_id
        or new.company_id is distinct from old.company_id then
        raise exception 'Platform roles must be changed by a database administrator';
      end if;
    end if;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;

-- Confirm the stored profile role in SQL Editor (auth.uid() is null there).
select u.email, p.role
from auth.users u join public.profiles p on p.id = u.id
where lower(u.email) = 'harshkansara99@gmail.com';

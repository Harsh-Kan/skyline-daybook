-- Apply after the safe-bank-delete and transaction-storage migrations as postgres.
-- SUPER_ADMIN membership is platform-wide; ordinary membership stays company-scoped.
begin;

create or replace function public.is_platform_super_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.company_users m
    where m.user_id = auth.uid() and lower(m.role::text) = 'super_admin'
  );
$$;
alter function public.is_platform_super_admin() owner to postgres;
revoke all on function public.is_platform_super_admin() from public, anon;
grant execute on function public.is_platform_super_admin() to authenticated;

-- Platform privileges must never be self-assigned via the public API.
create or replace function public.protect_platform_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      if lower(new.role::text) = 'super_admin' then
        raise exception 'Platform roles must be assigned by a database administrator';
      end if;
    elsif lower(new.role::text) = 'super_admin' or lower(old.role::text) = 'super_admin' then
      if new.role is distinct from old.role or new.user_id is distinct from old.user_id
        or new.company_id is distinct from old.company_id then
        raise exception 'Platform roles must be changed by a database administrator';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_platform_role on public.company_users;
create trigger protect_platform_role before insert or update on public.company_users
for each row execute function public.protect_platform_role();

create or replace function public.platform_company_index(p_offset integer default 0, p_limit integer default 500)
returns table (
  id uuid, company_name text, plan_name text, status text, payment_status text,
  created_at text, banks_used bigint, users_used bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_super_admin() then raise exception 'SUPER_ADMIN access required' using errcode = '42501'; end if;
  return query
  select c.id, c.company_name::text, c.plan_name::text,
    coalesce(nullif(to_jsonb(c)->>'status', ''), case when to_jsonb(c)->>'is_active' = 'false' then 'Suspended' else 'Unknown' end),
    nullif(to_jsonb(c)->>'payment_status', ''), to_jsonb(c)->>'created_at',
    (select count(*) from public.banks b where b.company_id = c.id and lower(btrim(b.name)) <> 'cash account'),
    (select count(distinct m.user_id) from public.company_users m where m.company_id = c.id)
  from public.companies c
  order by c.id
  limit greatest(1, least(p_limit, 500)) offset greatest(p_offset, 0);
end;
$$;
alter function public.platform_company_index(integer, integer) owner to postgres;
revoke all on function public.platform_company_index(integer, integer) from public, anon;
grant execute on function public.platform_company_index(integer, integer) to authenticated;

alter table public.companies enable row level security;
alter table public.company_users enable row level security;
alter table public.banks enable row level security;

drop policy if exists platform_companies_read on public.companies;
create policy platform_companies_read on public.companies for select to authenticated
using (public.is_platform_super_admin());
drop policy if exists platform_members_read on public.company_users;
create policy platform_members_read on public.company_users for select to authenticated
using (public.is_platform_super_admin());
drop policy if exists platform_banks_read on public.banks;
create policy platform_banks_read on public.banks for select to authenticated
using (public.is_platform_super_admin());
drop policy if exists platform_banks_insert on public.banks;
create policy platform_banks_insert on public.banks for insert to authenticated
with check (public.is_platform_super_admin() and user_id = auth.uid());
drop policy if exists platform_banks_update on public.banks;
create policy platform_banks_update on public.banks for update to authenticated
using (public.is_platform_super_admin()) with check (public.is_platform_super_admin());

-- Keep company boundaries for ordinary users, while allowing a verified platform admin.
alter policy daybook_transaction_company_boundary on public.transactions
using (
  public.is_platform_super_admin() or (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.company_id = transactions.company_id)
    and exists (select 1 from public.company_users m where m.user_id = auth.uid() and m.company_id = transactions.company_id)
  )
)
with check (
  (public.is_platform_super_admin() or (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.company_id = transactions.company_id)
    and exists (select 1 from public.company_users m where m.user_id = auth.uid() and m.company_id = transactions.company_id)
  ))
  and exists (select 1 from public.banks b where b.id = transactions.bank_id and b.company_id = transactions.company_id)
);

-- Extend only the authorization check in the reviewed safe-delete function.
-- Fail atomically if its definition differs from the installed repository version.
do $migration$
declare
  definition text;
  original text := E'if not exists (\n    select 1 from public.profiles p\n    where p.id = caller and p.company_id = p_company_id\n  ) or not exists (\n    select 1 from public.company_users m\n    where m.user_id = caller and m.company_id = p_company_id\n      and lower(m.role::text) in (''admin'', ''super_admin'')\n  ) then';
begin
  definition := replace(pg_get_functiondef('public.delete_bank_if_unused(uuid,uuid)'::regprocedure), chr(13), '');
  if position(original in definition) > 0 then
    execute replace(definition, original,
      replace(replace(original, 'if not exists', 'if not public.is_platform_super_admin() and (not exists'), E'  ) then', E'  )) then'));
  elsif position('if not public.is_platform_super_admin() and (not exists' in definition) = 0 then
    raise exception 'Safe bank deletion authorization differs from the reviewed version. No changes applied';
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
commit;

-- Run the entire file in the Supabase SQL Editor as postgres.
-- Prepared from the verified transactions_bank_id_fkey screenshot:
-- transactions(bank_id) -> banks(id), validated, immediate, ON DELETE CASCADE.
-- No bank or transaction records are deleted or updated by this migration.
-- Any error rolls back both the constraint change and function installation.
begin;
set local lock_timeout = '10s';

lock table public.banks, public.transactions in access exclusive mode;

-- Stop instead of guessing if the database differs from the inspected schema.
do $migration$
begin
  if current_user <> 'postgres' then
    raise exception 'Run this migration as the postgres role in Supabase SQL Editor';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint fk
    join pg_catalog.pg_attribute child
      on child.attrelid = fk.conrelid and child.attnum = fk.conkey[1]
    join pg_catalog.pg_attribute parent
      on parent.attrelid = fk.confrelid and parent.attnum = fk.confkey[1]
    where fk.conname = 'transactions_bank_id_fkey'
      and fk.contype = 'f'
      and fk.conrelid = 'public.transactions'::regclass
      and fk.confrelid = 'public.banks'::regclass
      and cardinality(fk.conkey) = 1 and cardinality(fk.confkey) = 1
      and child.attname = 'bank_id' and parent.attname = 'id'
      and fk.convalidated and not fk.condeferrable
  ) then
    raise exception 'The transaction foreign key differs from the inspected schema. No changes applied';
  end if;
  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.banks'::regclass
      and not tgisinternal and tgenabled <> 'D' and (tgtype & 8) <> 0
  ) then
    raise exception 'Review custom bank DELETE triggers before enabling deletion. No changes applied';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint
    where contype = 'f' and confrelid = 'public.banks'::regclass
      and not (conrelid = 'public.transactions'::regclass
               and conname = 'transactions_bank_id_fkey')
      and confdeltype not in ('a', 'r')
  ) then
    raise exception 'Another cascading bank reference needs review. No changes applied';
  end if;
end;
$migration$;

alter table public.transactions
  drop constraint transactions_bank_id_fkey,
  add constraint transactions_bank_id_fkey
    foreign key (bank_id) references public.banks(id)
    on delete restrict not deferrable;

create or replace function public.delete_bank_if_unused(p_company_id uuid, p_bank_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  caller uuid := auth.uid();
  bank_name text;
  transaction_column name;
  has_transactions boolean;
  deleted_id uuid;
begin
  if caller is null then raise exception 'Please sign in again'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = caller and p.company_id = p_company_id
  ) or not exists (
    select 1 from public.company_users m
    where m.user_id = caller and m.company_id = p_company_id
      and lower(m.role::text) in ('admin', 'super_admin')
  ) then
    raise exception 'Only an administrator of this company can delete a bank';
  end if;

  select b.name into bank_name from public.banks b
  where b.id = p_bank_id and b.company_id = p_company_id for update;
  if not found then raise exception 'Bank not found in your company'; end if;
  if lower(btrim(bank_name)) = 'cash account' then
    raise exception 'Cash Account cannot be deleted';
  end if;

  -- Never let deletion cascade to another table or clear its bank reference.
  if exists (
    select 1 from pg_catalog.pg_constraint fk
    where fk.contype = 'f' and fk.confrelid = 'public.banks'::regclass
      and fk.confdeltype not in ('a', 'r')
  ) then
    raise exception 'Safe bank deletion requires non-cascading foreign keys. Review the banks reference constraints first';
  end if;

  select child.attname into transaction_column
  from pg_catalog.pg_constraint fk
  join pg_catalog.pg_attribute child
    on child.attrelid = fk.conrelid and child.attnum = fk.conkey[1]
  join pg_catalog.pg_attribute parent
    on parent.attrelid = fk.confrelid and parent.attnum = fk.confkey[1]
  where fk.contype = 'f'
    and fk.conrelid = 'public.transactions'::regclass
    and fk.confrelid = 'public.banks'::regclass
    and fk.convalidated and not fk.condeferrable
    and fk.confdeltype in ('a', 'r')
    and cardinality(fk.conkey) = 1 and cardinality(fk.confkey) = 1
    and parent.attname = 'id'
  limit 1;
  if transaction_column is null then
    raise exception 'Safe bank deletion requires a validated immediate foreign key from transactions to banks.id with ON DELETE RESTRICT or NO ACTION';
  end if;

  -- Definer permissions must see all transaction rows, including rows hidden
  -- from the caller by RLS. Do not add a company filter that could miss history.
  execute format('select exists (select 1 from public.transactions where %I = $1)', transaction_column)
    into has_transactions using p_bank_id;
  if has_transactions then
    raise exception 'This bank has transactions and cannot be deleted';
  end if;

  -- The bank row lock and immediate FK serialize concurrent references. A
  -- concurrent transaction insert cannot leave a reference to the deleted UUID.
  delete from public.banks
  where id = p_bank_id and company_id = p_company_id
  returning id into deleted_id;
  if deleted_id is null then raise exception 'Bank deletion was not confirmed'; end if;
  return deleted_id;
end;
$$;

revoke all on function public.delete_bank_if_unused(uuid, uuid) from public, anon;
grant execute on function public.delete_bank_if_unused(uuid, uuid) to authenticated;


-- row_security=off above makes restricted execution fail rather than silently
-- hide transaction rows; it does not disable table RLS or grant table access.
alter function public.delete_bank_if_unused(uuid, uuid) owner to postgres;
notify pgrst, 'reload schema';
commit;

-- Verification only: installing the function does not delete a bank.
select
  to_regprocedure('public.delete_bank_if_unused(uuid,uuid)') as installed_function,
  pg_get_constraintdef(oid) as transaction_protection
from pg_catalog.pg_constraint
where conrelid = 'public.transactions'::regclass
  and conname = 'transactions_bank_id_fkey';
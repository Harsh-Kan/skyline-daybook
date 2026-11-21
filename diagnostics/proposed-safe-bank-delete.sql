-- REVIEW ONLY: no SQL in this file has been executed by Codex.
-- The frontend calls this function; it never calls DELETE on banks directly.
-- Review the inspection queries first. No transaction data is modified.

-- 1. Inspect the real transaction column names and types.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'transactions'
order by ordinal_position;

-- 2. Inspect every foreign key referencing banks, especially ON DELETE actions.
select conname, conrelid::regclass as referencing_table,
       pg_get_constraintdef(oid) as definition, convalidated, condeferrable
from pg_constraint
where contype = 'f' and confrelid = 'public.banks'::regclass;

-- 3. Review any existing user triggers before approving a DELETE function.
select tgrelid::regclass as table_name, tgname, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid in ('public.banks'::regclass, 'public.transactions'::regclass)
  and not tgisinternal;

-- Proposed function. Requires a validated, immediate, single-column foreign key
-- from public.transactions to banks.id with ON DELETE RESTRICT or NO ACTION.
-- The actual transaction reference column is discovered from that constraint.
-- If that protection is missing, this function refuses to delete anything.
-- If it is missing, propose the exact FK only after reviewing the above results
-- and existing/orphaned data. Do not substitute CASCADE or delete orphaned rows.

create function public.delete_bank_if_unused(p_company_id uuid, p_bank_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
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

-- Keep RLS enabled. Install only under a trusted function owner that can see
-- all banks/transactions; inspect FORCE RLS/owner privileges when reviewing.
-- Protect membership/profile ownership against self-escalation. The function
-- performs explicit tenant/admin checks because SECURITY DEFINER may bypass RLS.
-- No frontend service-role key or broad DELETE grant is required.

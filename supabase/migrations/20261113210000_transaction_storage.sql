-- Run in the matching Supabase project's SQL Editor as postgres.
-- Uses the existing transactions table; no historical rows are changed.
begin;
set local lock_timeout = '10s';

alter table public.transactions enable row level security;
grant select, insert, update, delete on public.transactions to authenticated;

create index if not exists transactions_company_id_id_idx on public.transactions(company_id, id);
create index if not exists transactions_bank_id_idx on public.transactions(bank_id);
create unique index if not exists banks_id_company_id_transaction_key on public.banks(id, company_id);

-- NOT VALID preserves legacy records while enforcing tenant-safe references on
-- all new inserts/updates. Review old null or mismatched company IDs separately.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.transactions'::regclass
      and conname = 'transactions_bank_company_fkey'
  ) then
    alter table public.transactions add constraint transactions_bank_company_fkey
      foreign key (bank_id, company_id) references public.banks(id, company_id)
      on delete restrict not valid;
  end if;
end;
$$;

-- A restrictive policy also constrains any existing permissive legacy policies.
drop policy if exists daybook_transaction_company_boundary on public.transactions;
create policy daybook_transaction_company_boundary on public.transactions
as restrictive for all to public
using (
  exists (select 1 from public.profiles p
          where p.id = (select auth.uid()) and p.company_id = transactions.company_id)
  and exists (select 1 from public.company_users m
              where m.user_id = (select auth.uid()) and m.company_id = transactions.company_id)
)
with check (
  exists (select 1 from public.profiles p
          where p.id = (select auth.uid()) and p.company_id = transactions.company_id)
  and exists (select 1 from public.company_users m
              where m.user_id = (select auth.uid()) and m.company_id = transactions.company_id)
  and exists (select 1 from public.banks b
              where b.id = transactions.bank_id and b.company_id = transactions.company_id)
);

drop policy if exists daybook_transactions_select on public.transactions;
create policy daybook_transactions_select on public.transactions for select to authenticated using (true);
drop policy if exists daybook_transactions_insert on public.transactions;
create policy daybook_transactions_insert on public.transactions for insert to authenticated
with check (created_by = (select auth.uid()) and user_id = (select auth.uid()));
drop policy if exists daybook_transactions_update on public.transactions;
create policy daybook_transactions_update on public.transactions for update to authenticated
using (true) with check (true);
drop policy if exists daybook_transactions_delete on public.transactions;
create policy daybook_transactions_delete on public.transactions for delete to authenticated using (true);

-- Protect identity fields even if an older permissive policy grants more access.
-- This is SECURITY INVOKER: RLS continues to apply to every frontend write.
create or replace function public.daybook_validate_transaction_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.company_id is null or new.bank_id is null then
    raise exception 'A company and bank are required';
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null then
    if new.user_id is distinct from auth.uid() or new.created_by is distinct from auth.uid() then
      raise exception 'Transaction creator must match the authenticated user';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.company_id is distinct from old.company_id
      or new.user_id is distinct from old.user_id or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Transaction identity and ownership cannot be changed';
    end if;
  end if;
  new.payment_in := coalesce(new.payment_in, 0);
  new.payment_out := coalesce(new.payment_out, 0);
  if new.payment_in < 0 or new.payment_out < 0
    or new.payment_in = 'NaN'::numeric or new.payment_out = 'NaN'::numeric
    or (new.payment_in > 0 and new.payment_out > 0) then
    raise exception 'Enter a valid payment in or payment out';
  end if;
  if btrim(new.particulars) = '' or new.transaction_type not in ('GST', 'Non-GST') then
    raise exception 'Enter particulars and a valid transaction type';
  end if;
  return new;
end;
$$;
drop trigger if exists daybook_validate_transaction_write on public.transactions;
create trigger daybook_validate_transaction_write before insert or update on public.transactions
for each row execute function public.daybook_validate_transaction_write();

notify pgrst, 'reload schema';
commit;

-- Verify installation: expect the company boundary and four operation policies.
select policyname, permissive, roles, cmd
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'transactions'
  and policyname in (
    'daybook_transaction_company_boundary',
    'daybook_transactions_select', 'daybook_transactions_insert',
    'daybook_transactions_update', 'daybook_transactions_delete'
  )
order by policyname;

-- REVIEW ONLY. NOT EXECUTED. Requires explicit approval before application.
-- Inspect current schema, policies, triggers, function ownership and grants first.
-- This does not enable/disable RLS, grant client permissions, change existing
-- companies/plans/dates, delete records, or remove users/accounts above a limit.
-- Assumes the existing id/company_id UUID columns, banks.name, company_users.user_id,
-- companies.plan_name/trial_start_date/trial_end_date/created_at columns.
-- Verify trial date column types before approving. Membership roles and company
-- subscription fields MUST be protected against client self-escalation by RLS
-- and column privileges. SECURITY DEFINER below must be owned by a trusted role.

-- New companies receive Trial defaults; existing companies are untouched.
create function public.initialize_company_trial()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if lower(btrim(new.plan_name)) = 'trial' then
    new.max_banks := 1;
    new.max_users := 1;
    new.trial_start_date := now();
    new.trial_end_date := now() + interval '14 days';
  end if;
  return new;
end;
$$;

create trigger initialize_company_trial_before_insert
before insert on public.companies
for each row execute function public.initialize_company_trial();

-- Lock the company row so simultaneous bank/member inserts serialize, and count
-- the real database rows even if caller RLS would hide some of them.
create function public.enforce_company_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  company public.companies%rowtype;
  bank_limit integer;
  user_limit integer;
  used_slots integer;
  trial_end timestamptz;
begin
  select * into company from public.companies
  where id = new.company_id for update;
  if not found then raise exception 'Company not found'; end if;

  -- Changes of ownership/identity need a separate audited administrative flow.
  if tg_op = 'UPDATE' then
    if new.company_id is distinct from old.company_id then
      raise exception 'Company ownership cannot be changed';
    end if;
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
      raise exception 'Record identity and user ownership cannot be changed';
    end if;
    if tg_table_name = 'banks' then
      if lower(btrim(old.name)) = 'cash account' and new.name is distinct from old.name then
        raise exception 'Cash Account cannot be renamed';
      end if;
      if (lower(btrim(old.name)) = 'cash account') is distinct from
         (lower(btrim(new.name)) = 'cash account') then
        raise exception 'Cash identity cannot be changed';
      end if;
    end if;
    -- Existing rows remain editable even after expiry or a plan downgrade.
    return new;
  end if;

  if tg_table_name = 'banks' then
    if lower(btrim(new.name)) = 'cash account' then
      if exists (select 1 from public.banks
        where company_id = new.company_id and lower(btrim(name)) = 'cash account') then
        raise exception 'Cash Account already exists';
      end if;
      -- Default Cash is free even at the paid limit or after Trial expiry.
      return new;
    end if;
  end if;

  case lower(btrim(company.plan_name))
    when 'trial' then
      bank_limit := 1; user_limit := 1;
      trial_end := coalesce(company.trial_end_date::timestamptz,
        coalesce(company.trial_start_date::timestamptz, company.created_at::timestamptz)
          + interval '14 days');
      if trial_end is null then raise exception 'Trial end date is not configured'; end if;
      if now() >= trial_end then raise exception 'The 14-day Trial has ended'; end if;
    when 'startup' then bank_limit := 2; user_limit := 2;
    when 'growth' then bank_limit := 5; user_limit := 5;
    when 'business' then bank_limit := null; user_limit := 10;
    else raise exception 'Company subscription plan is not configured';
  end case;

  if tg_table_name = 'banks' then
    select count(*) into used_slots from public.banks
    where company_id = new.company_id and lower(btrim(name)) <> 'cash account';
    if bank_limit is not null and used_slots >= bank_limit then
      raise exception 'Subscription bank limit reached';
    end if;
  elsif tg_table_name = 'company_users' then
    if exists (select 1 from public.company_users
      where company_id = new.company_id and user_id = new.user_id) then
      raise exception 'Company membership already exists';
    end if;
    select count(distinct user_id) into used_slots from public.company_users
    where company_id = new.company_id;
    if used_slots >= user_limit then raise exception 'Subscription user limit reached'; end if;
  end if;
  return new;
end;
$$;

-- Trigger functions are not intended as public RPC endpoints.
revoke all on function public.initialize_company_trial() from public, anon, authenticated;
revoke all on function public.enforce_company_subscription() from public, anon, authenticated;

create trigger enforce_banks_subscription
before insert or update on public.banks
for each row execute function public.enforce_company_subscription();

create trigger enforce_members_subscription
before insert or update on public.company_users
for each row execute function public.enforce_company_subscription();

-- Default Cash provisioning remains in the app; a database company-creation
-- transaction/RPC could provision it for all clients once that flow is reviewed.
-- No DELETE allowance is added. Existing policies/grants must deny physical
-- deletion, and real transaction references should use restrictive foreign keys.
-- This proposal must be validated in a development database before production.

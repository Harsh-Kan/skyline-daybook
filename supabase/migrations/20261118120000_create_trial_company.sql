begin;

create or replace function public.create_trial_company(p_company_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  company_name_input text := btrim(p_company_name);
  company_id_result uuid;
  trial_start timestamptz := now();
begin
  if caller_id is null or not exists (
    select 1 from auth.users u where u.id = caller_id and u.email_confirmed_at is not null
  ) then
    raise exception 'Confirm your email and sign in before creating a company.' using errcode = '42501';
  end if;

  if company_name_input is null or company_name_input = '' then
    raise exception 'Please enter a company name.' using errcode = '22023';
  end if;

  if public.is_platform_super_admin() then
    raise exception 'Platform administrators cannot create a company through signup.' using errcode = '42501';
  end if;

  -- Serialize retries and concurrent submissions for the same profile.
  select p.company_id into company_id_result
  from public.profiles p where p.id = caller_id for update;
  if not found then
    raise exception 'Your account profile is missing. Contact support before creating a company.';
  end if;

  if company_id_result is not null then
    if exists (select 1 from public.company_users m
      where m.user_id = caller_id and m.company_id = company_id_result) then
      return company_id_result;
    end if;
    raise exception 'Your company profile has no matching membership. Contact support.';
  end if;

  if exists (select 1 from public.company_users m where m.user_id = caller_id) then
    raise exception 'Your account already has a company membership. Contact support to link your profile.';
  end if;

  insert into public.companies (
    company_name, plan_name, max_banks, max_users, trial_start_date, trial_end_date,
    status, payment_status, is_active
  ) values (
    company_name_input, 'Trial', 1, 1, trial_start, trial_start + interval '14 days',
    'Active', 'trial', true
  ) returning id into company_id_result;

  insert into public.company_users (company_id, user_id, role)
  values (company_id_result, caller_id, 'admin');

  update public.profiles set company_id = company_id_result where id = caller_id;

  insert into public.banks (company_id, user_id, name, position)
  values (company_id_result, caller_id, 'Bank Account 1', 1),
         (company_id_result, caller_id, 'Cash Account', 2);

  return company_id_result;
end;
$$;

alter function public.create_trial_company(text) owner to postgres;
revoke all on function public.create_trial_company(text) from public, anon, authenticated;
grant execute on function public.create_trial_company(text) to authenticated;

-- Onboarding and workspace loading need to read the caller's membership, then
-- their linked company and its accounts. The policies grant SELECT only.
drop policy if exists own_company_membership_read on public.company_users;
create policy own_company_membership_read on public.company_users for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists linked_company_read on public.companies;
create policy linked_company_read on public.companies for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.company_id = companies.id)
  and exists (select 1 from public.company_users m where m.user_id = (select auth.uid()) and m.company_id = companies.id)
);

drop policy if exists linked_company_banks_read on public.banks;
create policy linked_company_banks_read on public.banks for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.company_id = banks.company_id)
  and exists (select 1 from public.company_users m where m.user_id = (select auth.uid()) and m.company_id = banks.company_id)
);

notify pgrst, 'reload schema';
commit;

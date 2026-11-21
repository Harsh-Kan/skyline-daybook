begin;

create or replace function public.rename_company(p_company_id uuid, p_company_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  company_name_input text := regexp_replace(p_company_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  saved_name text;
begin
  if caller_id is null or not (
    public.is_platform_super_admin() or exists (
      select 1
      from public.profiles p
      join public.company_users m on m.user_id = p.id and m.company_id = p.company_id
      where p.id = caller_id and p.company_id = p_company_id and lower(m.role::text) = 'admin'
    )
  ) then
    raise exception 'Only administrators can rename this company.' using errcode = '42501';
  end if;

  if company_name_input is null or company_name_input = '' then
    raise exception 'Please enter a company name.' using errcode = '22023';
  end if;

  update public.companies c
    set company_name = company_name_input
    where c.id = p_company_id
    returning c.company_name into saved_name;
  if not found then
    raise exception 'The company could not be found.';
  end if;
  return saved_name;
end;
$$;

alter function public.rename_company(uuid, text) owner to postgres;
revoke all on function public.rename_company(uuid, text) from public, anon, authenticated;
grant execute on function public.rename_company(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;

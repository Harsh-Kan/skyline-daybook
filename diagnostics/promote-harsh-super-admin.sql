-- Run in the matching Supabase project's SQL Editor as postgres.
-- Apply the profile-platform-role migration first. Promotes only this profile.
begin;

do $$
declare
  target_user_id uuid;
  affected integer;
begin
  select id into strict target_user_id
  from auth.users
  where lower(email) = 'harshkansara99@gmail.com';

  update public.profiles
  set role = 'super_admin'
  where id = target_user_id;

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Expected one profile, found %. No role was changed.', affected;
  end if;
end;
$$;

select u.email, p.company_id, p.role
from auth.users u
join public.profiles p on p.id = u.id
where lower(u.email) = 'harshkansara99@gmail.com';

commit;

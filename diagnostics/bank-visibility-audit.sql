-- READ-ONLY AUDIT FOR REVIEW. Not executed by Codex.
-- Run in the SQL Editor of the SAME project as VITE_SUPABASE_URL.
-- SQL Editor visibility does not prove frontend RLS access.
-- Compare these IDs with the authenticated user's UUID in the browser.

select id as profile_user_id, company_id as profile_company_id
from public.profiles
order by id;

select id as bank_id, company_id as bank_company_id,
       user_id as bank_created_by, name, position
from public.banks
order by company_id, position, id;

select user_id as member_user_id, company_id as member_company_id, role
from public.company_users
order by user_id, company_id;

-- Compare each profile with the bank ownership and company membership.
select p.id as profile_user_id, p.company_id as profile_company_id,
       b.id as bank_id, b.company_id as bank_company_id,
       b.user_id as bank_created_by,
       exists (
         select 1 from public.company_users cu
         where cu.user_id = p.id and cu.company_id = p.company_id
       ) as has_membership_for_profile_company
from public.profiles p
left join public.banks b on b.company_id = p.company_id
order by p.id, b.position, b.id;

-- Inspect SELECT and ALL policies, including membership/profile dependencies.
-- Restrictive policies can still deny rows even if a permissive policy allows them.
select schemaname, tablename, policyname, permissive, roles,
       cmd, qual as using_expression, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('banks', 'company_users', 'profiles', 'companies')
order by tablename, cmd, policyname;

select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('banks', 'company_users', 'profiles', 'companies');

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('banks', 'company_users', 'profiles', 'companies')
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by table_name, grantee, privilege_type;

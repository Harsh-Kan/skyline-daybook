-- PROPOSAL FOR REVIEW ONLY. NOT EXECUTED.
-- First inspect bank-visibility-audit.sql results and the existing SELECT policy.
-- These statements assume the existing columns used by the application, readable
-- own-profile/membership rows, and roles stored as admin or super_admin.
-- A company ID mismatch must be resolved separately, based on verified ownership.
-- Existing permissive ALL/write policies may grant broader access and must be
-- reviewed. Existing restrictive policies may still deny these operations.
-- Do not run blindly or add policies with names that already exist.

create policy "banks_insert_company_admins"
on public.banks
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.company_id = banks.company_id
  )
  and exists (
    select 1 from public.company_users as membership
    where membership.company_id = banks.company_id
      and membership.user_id = (select auth.uid())
      and lower(membership.role::text) in ('admin', 'super_admin')
  )
);

create policy "banks_update_company_admins"
on public.banks
for update
to authenticated
using (
  exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.company_id = banks.company_id
  )
  and exists (
    select 1 from public.company_users as membership
    where membership.company_id = banks.company_id
      and membership.user_id = (select auth.uid())
      and lower(membership.role::text) in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.company_id = banks.company_id
  )
  and exists (
    select 1 from public.company_users as membership
    where membership.company_id = banks.company_id
      and membership.user_id = (select auth.uid())
      and lower(membership.role::text) in ('admin', 'super_admin')
  )
);

-- Additional database requirements to review, not SQL applied by this project:
-- 1. banks.id must default to a database-generated UUID.
-- 2. authenticated needs SELECT/INSERT and UPDATE(name, position) privileges.
--    Column UPDATE grants do not narrow an existing table-level UPDATE grant.
--    Review inherited/PUBLIC grants too before changing privileges.
-- 3. Keep IDs, company_id, user_id, and Cash identity immutable on UPDATE.
-- 4. Do not permit physical bank deletion through client roles. Foreign keys
--    from real transactions should prevent deleting referenced bank records.
-- 5. Enforce the paid bank limit atomically in the database, excluding Cash.
--    The current frontend checks do not prevent simultaneous inserts in tabs.
-- 6. Prevent duplicate Cash accounts per company and reserve Cash identity.
-- 7. Keep membership roles/company assignments protected against self-escalation.
-- Cash identity currently uses the canonical name because no verified is_cash
-- or archive column is available. Do not invent either column in application code.

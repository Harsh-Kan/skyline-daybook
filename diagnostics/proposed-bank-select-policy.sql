-- CONDITIONAL PROPOSAL ONLY. NOT EXECUTED. Review the audit output first.
-- Appropriate if company IDs and membership match, but bank SELECT currently
-- restricts access to the creating user or has no applicable allowing policy.
-- Assumes authenticated users can SELECT their own company_users membership.
-- Do not add a reciprocal membership policy that queries banks (RLS recursion).
-- Existing restrictive policies must be reviewed separately. Existing permissive
-- policies can also grant broader access; this policy does not revoke them.

create policy "banks_select_company_members"
on public.banks
for select
to authenticated
using (
  exists (
    select 1
    from public.company_users as membership
    where membership.company_id = banks.company_id
      and membership.user_id = (select auth.uid())
  )
);

-- Does not change INSERT, UPDATE, DELETE, ownership, IDs, or RLS enablement.
-- Does not fix incorrect company_id values or a missing company membership.

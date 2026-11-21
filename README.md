<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/temp/1

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Supabase bank deletion setup

Run the entire contents of
[`supabase/migrations/20261113195000_install_safe_bank_delete.sql`](supabase/migrations/20261113195000_install_safe_bank_delete.sql)
in the matching Supabase project's SQL Editor using the `postgres` role.
This migration replaces the verified cascading `transactions.bank_id` foreign key
with `ON DELETE RESTRICT`, installs `delete_bank_if_unused`, and refreshes the API
schema cache. It preserves existing records and applies the changes in one transaction.
It stops if the inspected foreign key has changed or unreviewed bank deletion
triggers or other cascading references exist.

The final query should return `delete_bank_if_unused(uuid,uuid)` and a foreign key
definition containing `ON DELETE RESTRICT`. Then retry deleting an unused bank in
Settings. Cash Account and banks referenced by database transactions remain protected.
The app also checks loaded database transactions before calling the RPC.

## Supabase transaction storage

Run [`supabase/migrations/20261113210000_transaction_storage.sql`](supabase/migrations/20261113210000_transaction_storage.sql)
in the matching project's SQL Editor as `postgres`. It uses the existing table
schema, enables RLS, adds company membership policies, and enforces that each new
transaction references a bank in the same company. Existing rows are preserved;
rows with missing or incorrect company IDs need a separate ownership review.
Existing restrictive policies on this table can still deny access and should be
reviewed if the database returns a permission error.

Transactions load from Supabase on sign-in, reload, and window focus. Inserts use
database UUIDs and timestamps, with the authenticated user as `user_id` and
`created_by`. Updates and deletes filter by both transaction ID and company ID.
The UI waits for database confirmation and preserves form contents on failure.
The application no longer reads or writes the old `skyline_transactions` or
`skyline_user` caches. Supabase Auth continues to manage its own sign-in session.
Browser-only historical entries have not been automatically uploaded or erased;
there is no import button or browser-storage fallback.

Validation: `node tests/bank-sync.test.mjs`, `npx tsc --noEmit`, and `npm run build`.
The integration tests use a mock Supabase client; apply and verify the SQL in the
hosted project before relying on its database policies.

## SUPER_ADMIN Company Switchboard

Apply [20261117120000_platform_switchboard.sql](supabase/migrations/20261117120000_platform_switchboard.sql)
in the matching Supabase SQL Editor as `postgres`, after both earlier migrations.
The script installs the protected, paginated company index RPC, platform read and
bank write policies, and extends the existing transaction boundary and safe bank
deletion authorization. It preserves the transaction creator and company filters.
It stops atomically if the installed safe-delete authorization differs from the
reviewed version. Review any additional custom restrictive policies or triggers:
they can still deny cross-company access and are not removed by this migration.

Then apply [20261117130000_profile_platform_role.sql](supabase/migrations/20261117130000_profile_platform_role.sql)
to recognize the platform role from `profiles.role` in both login and database
permissions. The existing profile value is preserved. `SUPER_ADMIN`, `super_admin`,
and `super admin` are recognized; existing membership-based platform roles remain
supported. A profile platform role works even without a home-company membership.

A `profiles.role` of `super_admin` grants platform-wide
access to all customer companies. Assign this role only through trusted database
administration; the migration blocks granting or moving this role through the public
API. It does not promote any user automatically. Ordinary admins and executives
retain their company scope. The index RPC rejects non-super-admin callers, rather
than relying on visibility of navigation controls.

SUPER_ADMIN lands on Company Switchboard after login and session restoration.
The index shows company/payment statuses, paid bank usage (Cash excluded), distinct
member usage, plan allowances, and creation dates when available. Overview counts
cover the whole directory, independent of search/filter. Serial numbers follow a
stable creation-date/ID order; users can sort either direction, A–Z, or newest first.
Unknown statuses, plans, and dates are explicitly shown as unavailable/unknown.
Trial counts identify the Trial plan and may overlap Active or Suspended counts.

Opening a company keeps the authenticated platform identity and loads only that
company's accounts and transactions. A persistent banner and Back to Company
Switchboard action remain available throughout the workspace. Returning clears
workspace data; switching waits for in-flight writes. Refreshing the app returns
SUPER_ADMIN to the platform index. Existing platform capabilities remain available
through the switchboard and company Account Settings; no additional login or
profile-company reassignment is performed.

The integration test covers regular-user behavior plus SUPER_ADMIN landing,
search/filter/sorting, switching between two companies, platform transaction
attribution, persistent banner, return navigation, and session restoration. These
tests use mock Supabase responses; live RLS and migration execution must be verified
against the hosted project after installation.

## Supabase company signup

Before deploying the updated app, apply
[20261118120000_create_trial_company.sql](supabase/migrations/20261118120000_create_trial_company.sql)
if it is not already applied, followed by
[20261118130000_rename_company.sql](supabase/migrations/20261118130000_rename_company.sql)
in the matching Supabase project's SQL Editor as `postgres`. Both follow the
platform role migrations.

The app creates **My Company** on the first confirmed sign-in for a user whose
profile has no company. The Trial plan, administrator membership, profile link,
and starting accounts are created in one transaction before the dashboard opens.
Retrying returns the linked company.

Administrators can change the name under **Account Settings → Company Profile**.
The dashboard and sidebar use the saved database value. Company administrators
can only rename their linked company. Platform administrators can rename the
company they open from the switchboard. Row-level security stays enabled.

If the company profile reports that the rename function is missing, run the
full rename migration in the SQL Editor of the project configured by
`VITE_SUPABASE_URL`. The migration can be reapplied and refreshes the API schema
cache. To verify the function signature and argument names in that project, run

```sql
select pg_get_function_arguments(to_regprocedure('public.rename_company(uuid,text)'));
```

The result should be `p_company_id uuid, p_company_name text`.

## Supabase password recovery

In **Authentication → URL Configuration**, set **Site URL** to the deployed
app’s URL. Add the exact deployed app URL with `?reset-password=1` as a
**Redirect URL** (for example, `https://your-app.example/?reset-password=1`).
If you test locally, allow the corresponding local URL separately using the
port where Vite is running.

Use Supabase’s `{{ .ConfirmationURL }}` for the link in the reset email
template so the recovery token is verified before the redirect. Once these
settings and the updated app are deployed, request a fresh reset email from
that app. After opening the link, enter and confirm a new password.

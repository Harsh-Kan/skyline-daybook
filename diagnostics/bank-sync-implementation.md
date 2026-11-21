Bank synchronization investigation and verification
==================================================

The bank source of truth is public.banks. App restores the Supabase session,
verifies the user with auth.getUser(), reads profiles.company_id, and requires a
matching company_users membership. It loads the company's bank UUIDs ordered by
position and ID into one bankConfigs state, passed to Settings, Dashboard, Ledger,
and Layout. Loading and failure states precede the account screens.

Settings follows new bankConfigs props. Add inserts a bank without supplying an
ID, obtains the returned database record, publishes it to App, and reloads the
company list. Rename/reorder update only name and position, verify an affected
row, and reload. Failed saves show an error. Bank writes also recheck the verified
identity, profile company, and admin membership. RLS is still required: frontend
checks cannot secure direct API requests.

The confirmed remaining dummy-data cause was App's unfiltered read of
skyline_transactions. The UI now excludes only the user-confirmed bank1/bank2
account references. Their original localStorage entries remain intact. No IDs
are mapped, balances migrated, or Supabase transactions read, inserted, updated,
or deleted as part of this work. Other transaction behavior/storage is unchanged;
this is a bank-management change, not a transaction-storage migration.

The earlier zero-bank warning means the company bank SELECT returned no visible
rows. Source inspection cannot establish whether live rows have another company
ID or are hidden by RLS. No authenticated database access or policy results were
provided. SQL compilation and simulated tests cannot resolve this uncertainty.

Cash is recognized by its canonical name (and existing BankConfig cash metadata),
uses its database UUID, is excluded from the paid bank count, and cannot be
renamed or deleted through this flow. Cash is provisioned automatically if missing
after the company and membership are verified. No Add Cash action is shown.
Provisioning reuses existing UUIDs, coalesces simultaneous calls in the same app,
and surfaces permission failures instead of creating a fake UI record. An admin
must initialize a missing Cash record; ordinary members can read it afterwards.
Database uniqueness is still required to prevent concurrent cross-tab inserts.
Bank deletion is
disabled for all accounts. Archiving is not implemented because an archive column
and its semantics have not been verified.

Files changed during the latest implementation:

- App.tsx: verify session identity before loading; exclude confirmed dummy IDs
  from all Dashboard/Ledger inputs without removing their stored entries.
- bankAccounts.ts: recheck authenticated identity, profile, and admin membership
  before inserts and name/order updates.
- components/Auth.tsx: remove email-based administrator assignment; company_users
  supplies permissions after authentication.
- tests/bank-sync.test.mjs: exercise login, insertion, all three account screens,
  remount/session restoration, logout/login, permissions failures, dummy exclusion,
  free Cash, account protection, and transaction preservation.
- diagnostics/proposed-bank-write-policies.sql: unexecuted INSERT/UPDATE proposals
  and database prerequisites.
- diagnostics/bank-sync-implementation.md: this report.

Default Cash follow-up changes: App.tsx, bankAccounts.ts,
components/Settings.tsx, components/CompanySetup.tsx, tests/bank-sync.test.mjs,
and this report. Cash initialization is automatic, respects RLS, ignores the paid
bank limit, and reuses its UUID on refresh. Tests cover automatic initialization,
permission failure/retry, and refresh without another Cash insert. No live SQL,
schema, policy, or hosted accounting record was changed during implementation.

Verification:

- node tests/bank-sync.test.mjs: real React DOM with a simulated Supabase client;
  includes a UUID-returning insert, shared state, full React unmount/remount,
  session restoration, and login/logout. No React errors were logged. The test
  preserves the localStorage transaction payload and simulated database rows.
- node node_modules/typescript/bin/tsc --noEmit: TypeScript check.
- npm.cmd run build: production build. Existing index.css missing-file warning
  is unrelated to bank synchronization.
- No live bank was inserted, no real UUID was verified in the hosted database,
  and no live authenticated RLS test was performed. Browser refresh is represented
  by a full app remount against retained simulated server data, not a live browser.

Remaining live verification:

Review bank-visibility-audit.sql (read-only, not executed), compare the actual
authenticated UUID and profile company against bank ownership and membership,
and inspect SELECT/INSERT/UPDATE/ALL policies, grants, and relevant dependencies.
proposed-bank-select-policy.sql and proposed-bank-write-policies.sql are conditional
proposals only. Do not execute them without reviewing existing policy interactions.
The real project must provide database UUID generation, protected membership,
immutable ownership/Cash identity, no client physical deletion, and atomic bank
limit/Cash uniqueness enforcement. Existing accounts above a limit are retained.

With a valid authenticated session and reviewed permissions, perform the user's
live sequence: log in; load company and banks; add one bank; compare its returned
UUID to the database; check Settings, Dashboard and Ledger; refresh; then log out
and log in again. Do not interpret the simulated test as proof of hosted RLS.

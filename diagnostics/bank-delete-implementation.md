Safe bank deletion
==================

The earlier bin was deliberately disabled because deletion/archiving was not
configured. The user has now authorized deleting unused banks, while requiring
all banks with transactions to be protected.

Settings now offers a confirmation for non-Cash banks. A bank with local
transactions has a disabled bin with an explanation. Cash has no delete action.
Pending name/order edits are saved before a confirmed deletion. App checks local
transactions again before calling bankAccounts.remove, which revalidates the
authenticated profile and administrator membership.

Deletion uses only delete_bank_if_unused, not a frontend table DELETE. The RPC
must verify the company/admin, lock the bank row, reject Cash and any database
transactions, and require an immediate restrictive transaction foreign key.
Only a returned matching UUID removes a bank from shared state. Settings,
Dashboard, Ledger selectors and the bank-slot count then update immediately.
Failed calls retain the bank and show an error.

The proposed-safe-bank-delete.sql file contains three inspection queries and the
review-only function definition. Nothing in it was executed. Its function discovers
the actual transaction account column from a verified single-column FK to banks.id,
rather than guessing account_id versus bank_id. Without that constraint, it refuses
deletion. It also refuses bank references configured with cascading/SET NULL/default
deletion actions. Review the actual schema and existing user triggers first.

This is not yet enabled in the hosted database. The RPC must be installed under
a trusted owner after schema/security review. Any required FK change must be
proposed separately using the actual audit results; orphaned records must not be
deleted to make a constraint pass. RLS is not disabled and no broad DELETE grant
or service-role frontend key is introduced.

Accounting transactions still use the app's existing localStorage behavior; no
transaction migration was performed. Local transaction checks are client-side;
the FK/RPC provides atomic protection for database transactions. A future move
of transaction storage to Supabase is needed for database enforcement across all
transaction writers and browser tabs.

Modified files: App.tsx, bankAccounts.ts, components/Settings.tsx,
tests/bank-sync.test.mjs, diagnostics/proposed-safe-bank-delete.sql, this report.

Checks performed: TypeScript noEmit, production Vite build, existing React
integration suite extended with local-transaction blocking, server-only transaction
blocking, Cash protection, company isolation, cancellation, missing-function and
missing-FK failures, successful unused-bank removal, shared UI updates and quota
slot recovery. React tests use a simulated RPC; hosted PostgreSQL SQL, RLS, FK
concurrency and live deletion have not been tested or executed.

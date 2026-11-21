Subscription requirements implemented
====================================

The active company's plan_name is read from Supabase; the product's entitlement
rules are defined once in subscriptions.ts:

| Plan | Users | Banks | Free Cash |
| --- | ---: | ---: | ---: |
| Trial (14 days) | 1 | 1 | 1 |
| Startup | 2 | 2 | 1 |
| Growth | 5 | 5 | 1 |
| Business | 10 | Unlimited | 1 |

Legacy max_banks/max_users values such as Business=999 no longer define these
plans in the frontend. Bank insertion re-reads the company plan before applying
the same entitlement rules. Business uses an unbounded bank limit, not 999.
Unknown plans fail closed. Cash remains default/free and outside bank quotas.

New company setup supplies Trial start/end dates 14 days apart and 1/1 limits.
Existing Trial dates are not rewritten or reset. If no explicit end is recorded,
Trial ends 14 days after trial_start_date (or created_at for legacy companies).
Missing usable dates produce an error rather than granting a fresh trial.
Expired Trial blocks additional paid banks; existing accounts, balances, Cash,
and bank name/order editing are preserved. Trial countdown refreshes on tab focus
or the plan refresh control; the bank insert handler checks expiry each time.

Settings displays plan entitlements, the Trial end time in India, remaining days,
and visible Supabase company membership. The former localStorage signup toggle,
editable Max Registrations, fake local user deletion, and password display were
removed from this company subscription screen. Their localStorage records are
not deleted. User-limit displays cannot guarantee a full membership count if
company_users SELECT RLS hides other company members; administrators need an
appropriate read policy.

There is currently no real company invitation/user-add workflow in this app.
Global Supabase sign-up creates an auth identity, not a company membership.
Enforcing the 1/2/5/10 member limits must occur on company_users in the database.
The unexecuted proposed-subscription-enforcement.sql provides an INSERT/UPDATE
trigger proposal with company row locking, quotas, Trial expiry, duplicate Cash
prevention, and immutable identities. Review schema/policies/function ownership
and test in development before approval. No SQL was run and no existing company,
subscription, membership, bank, or transaction was modified by these changes.

The database must also protect plan/date/role/company fields against client
self-escalation. The supplied screenshot shows RLS disabled on companies and
unrestricted banks/company_users; that state cannot be secured by frontend checks.
No RLS state was changed. The prior policy audit and proposed bank policies remain
review artifacts. Existing subscription/bank/member triggers must be inspected
for compatibility before applying another enforcement mechanism.

Changed files: subscriptions.ts, bankAccounts.ts, App.tsx,
components/Settings.tsx, components/CompanySetup.tsx, tests/bank-sync.test.mjs,
diagnostics/proposed-subscription-enforcement.sql, and this report.

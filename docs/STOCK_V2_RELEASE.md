# Stock V2 integrated release

This is the application source already running on Production, plus the reviewed
account-management fixes. Comparison against deployment
`dpl_G5Fib9K5MJ22KbPzanmcKAEkqDsn` found 105 of 107 source files identical;
only `api/stock-accounts.js` and `src/components/ManagedAccounts.jsx` differed.
No inventory business logic or database installation is part of this release.

## Validation

Use Node 24, `npm ci`, `npm test`, `npm run test:accounts`, `npm run lint`,
and `npm run build`. Tests are offline/mocked and do not prove live account
creation or PostgreSQL concurrency. SQL files under docs are contract references
used by static tests, never an automatic migration step. Do not run Fresh Install
against the existing database. Import manifests, bound seeds, logs and private
evidence are deliberately excluded.

## Environments

Both targets require `VITE_INVENTORY_V2_ENABLED=true`, a matching
`VITE_SUPABASE_URL`, public `VITE_SUPABASE_ANON_KEY` and
`VITE_SUPABASE_EXPECTED_PROJECT_REF`. The authorized V2 project is
`uziblxwylaxzjymdgrml`.

Preview uses `VITE_INVENTORY_ENVIRONMENT=preview`,
`VITE_INVENTORY_MUTATIONS_ENABLED=false` and
`STOCK_ACCOUNT_MUTATIONS_ENABLED=false`. No server secret is provisioned there.
It reads the existing V2 backend only through normal authenticated/RLS access;
it is not a separate database sandbox. Never perform mutation UAT there.

Production account administration additionally requires:
- `STOCK_ACCOUNT_PROJECT_REF` matching the V2 project;
- `STOCK_ACCOUNT_SECRET`: the actual Supabase V2 server secret credential, stored
  only as a sensitive Production variable in Vercel, never a VITE variable;
- `STOCK_ACCOUNT_MUTATIONS_ENABLED=true`, after owner release approval.

Without the secret the endpoint fails closed for account mutations; authenticated
enabled Admins can still list accounts. The server verifies the caller using Auth
and reads the current Admin/enabled state from profiles. Installed Auth triggers
create profiles transactionally; the database retains last-Admin protection.
Google Sheets sync remains unconfigured and disabled.

## Release and recovery

1. Push the reviewed branch and test its Preview; do not merge or promote yet.
2. Obtain owner approval for Production, configure the missing secret privately,
   and record the exact approved commit and environment values (never secrets).
3. Deploy that commit, verify login/navigation/read-only data and obtain separate
   approval for one real employee account before live creation/login verification.
4. If account management fails, set its server mutation flag false and redeploy
   or roll back to the recorded known-good Production deployment. Preserve all
   accounts and business data; deployment rollback does not undo database writes.

Production rollback point: `dpl_G5Fib9K5MJ22KbPzanmcKAEkqDsn`,
`https://inventory-pukux2jfd-emyada.vercel.app`.
Production domain: `https://inventory-app-psi-ten.vercel.app`.
No merge, Production deployment, secret change, database write or account creation
is authorized by completing the branch/Preview preparation alone.

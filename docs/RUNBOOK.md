# Miniso UK Finance OS — Backup & Restore Runbook

Operational guide for protecting and recovering the Finance OS. Internal use.

## What has to be protected

| Layer | Holds | Recovery source |
| --- | --- | --- |
| **Neon Postgres** | The system of record — every figure, forecast, session, audit event | Backups (below). This is the thing to protect. |
| **Vercel app** | Stateless code | Git (`main` + this branch). Redeploys from a push; holds no data. |
| **Environment secrets** | Keys the app needs to run | A password manager — **not** in the database or the repo (see inventory). |

The app tier is disposable: a total loss of Vercel is a redeploy. A loss of the
database or its secrets is the real incident, so the rest of this is about Neon.

## Secrets inventory (record these outside the database)

Keep current values in the team password manager. If the database is restored to
a new project, these must be set on the Vercel project for the app to work.

| Variable | Purpose | If lost |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection | Re-copy from the Neon project. |
| `SESSION_SECRET` | Signs session + MFA-pending cookies | Everyone is logged out (safe). If `MFA_SECRET_KEY` is unset, also makes enrolled TOTP secrets undecryptable — users fall back to recovery codes or an admin clears their MFA. |
| `MFA_SECRET_KEY` | Encrypts TOTP secrets at rest | Enrolled users must re-enrol (recovery code, or admin clear-MFA). Setting a dedicated value here decouples MFA from `SESSION_SECRET` rotation. |
| `JOIIN_API_KEY` | Joiin Connect API | Refresh stops until re-issued in Joiin. |
| `CRON_SECRET` | Authenticates the monthly Joiin cron | Cron refresh returns 401 until reset. |

## Backup layers

1. **Neon point-in-time restore (primary).** On a paid Neon plan, Neon retains
   WAL for continuous PITR across a retention window. Confirm the plan has PITR
   enabled and note the window (target: ≥ 7 days). This covers "undo a bad
   change" and "recover to 10 minutes ago" with no action needed up front.
2. **Monthly logical snapshot (belt-and-braces, off-Neon).** Take a `pg_dump`
   and store it somewhere that survives losing the Neon account entirely:
   ```
   pg_dump "$DATABASE_URL" --format=custom --no-owner --file=finos-YYYY-MM-DD.dump
   ```
   Run it after month-end close. Keep the last 12.
3. **Code-level rebuild (structure, not data).** The schema can be rebuilt from
   this repo with no backup at all:
   ```
   DATABASE_URL=… npm run init-db     # base schema (public.users + schemas)
   DATABASE_URL=… npm run migrate     # migrations 001 → 030, idempotent
   ```
   CI runs exactly this on every push, so it is always known-good. This restores
   an empty, correctly-shaped database; data comes from a dump or a re-load.

## Restore procedures

### A. Undo a bad change (most common) — Neon PITR
1. In the Neon console, create a branch from the timestamp just before the
   change.
2. Point a scratch Vercel preview at the branch's connection string and verify.
3. When happy, promote the branch (or copy corrected rows back).

### B. Full logical restore from a dump
1. Create a fresh Neon database/branch.
2. `pg_restore --no-owner --dbname="$NEW_DATABASE_URL" finos-YYYY-MM-DD.dump`
3. Point the app at it; run **Health check** below.

### C. Total loss — rebuild from code + re-load data
1. New Neon project → set `DATABASE_URL`.
2. `npm run init-db && npm run migrate` (schema).
3. Re-apply the delivered data loads (kept alongside this repo / in the data
   handover): Joiin H1 SQL, the board-pack seed, plan CSVs / forecast workbook,
   intercompany CSVs. Then run a Joiin refresh for current months.
4. Recreate users (`npm run create-user`) and set all secrets on Vercel.

## Health check after any restore

Hit `/api/health` (public) and confirm:
- `database: "connected"`, `users` > 0
- `schema.migrationsApplied` equals the migration count in `db/migrations`
- `sessionSecret: "set"` and `config` shows the integrations you expect

Then sign in, open **Dashboards → Management Accounts**, and spot-check a known
figure (e.g. a recent month's Group EBITDA) against the last board pack.

## Targets

- **RPO** (data loss tolerance): ≤ 10 minutes via Neon PITR; ≤ 1 month via the
  logical snapshot if Neon itself is lost.
- **RTO** (time to restore): PITR ≈ under an hour; full code rebuild + re-load ≈
  a few hours.

## Quarterly restore drill

Prove the backups actually work — a backup you have never restored is a hope,
not a backup.
1. Restore the latest monthly dump into a scratch Neon branch (procedure B).
2. Run the health check; confirm `ok: true`.
3. Sign in and spot-check one figure.
4. Note the date and result in the Action Centre; delete the scratch branch.

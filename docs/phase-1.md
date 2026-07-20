# Phase 1 — Foundations & Navigation

Delivered 20/07/2026. Scope: roles & permissions, audit trail, six-pillar navigation,
pillar hub pages, users & roles admin, data-freshness stamps, KPI definition sign-offs,
unit-test harness, dead-code removal.

## Database migrations

Run in Neon's SQL editor, in order (both idempotent — safe to re-run):

1. `db/migrations/001_roles_and_audit.sql` — `governance.role/permission/role_permission/user_role`,
   `users.is_active`, `governance.audit_event`; seeds 5 roles + permissions; assigns
   ADMIN to kris@kouriten.com and FINANCE to everyone else.
2. `db/migrations/002_navigation_and_definitions.sql` — `dashboard_registry.nav_pillar/route`;
   signed-off KPI definitions (ATV net basis, LFL rule, head-office exclusion) into
   `dim_kpi` + `signoff_log`; backfills `data_refresh_log` for the store-data loads.

Rollback: each file's header comment lists the exact statements. Nothing existing is
dropped or renamed; rollback removes only what the migration created.

## Roles

| Role | Intended for | Phase-1 effect |
|---|---|---|
| ADMIN | Platform administrators | Sees and uses Govern → Users & roles |
| EXEC / FINANCE / OPS | Internal team | Full dashboard access (scoping arrives with later phases) |
| FRANCHISEE | Franchise partners | Placeholder — store-scoped queries arrive in a later phase; do not issue logins yet |

Role claims are embedded in the session JWT at login. **Sessions issued before this
phase default to FINANCE — sign out/in once to pick up ADMIN.** Deactivated users
cannot log in.

## API contracts

`GET /api/admin/users` → `{ users: [{ id, email, name, is_active, roles[] }] }` — ADMIN only (401 unauthenticated / 403 not admin).

`POST /api/admin/users` — ADMIN only. Body `{ action, ... }`:
- `create`: `{ name, email, password (≥8), role }` → 409 if email exists.
- `set-role`: `{ userId, role }` — cannot demote yourself.
- `reset-password`: `{ userId, password (≥8) }`.
- `set-active`: `{ userId, isActive }` — cannot deactivate yourself.
All mutations write `governance.audit_event`. Roles limited to the five seeded codes.

## Navigation

Persistent top bar (all signed-in pages): HOME · PLAN · PERFORM · OPERATE · AI CONTROL
TOWER · GOVERN. Hub pages at `/plan`, `/perform`, `/operate`, `/ai`, `/govern` read
`dashboard_registry.nav_pillar`. Existing URLs unchanged (`/finance-os/*`, `/`).
Active pillar highlighting includes legacy routes. Login page shows no nav.

## Freshness

`governance.data_refresh_log` is now the source of truth for "how fresh is this data".
The Operate hub shows the latest successful load (source, time, row count). **Every
future data load must write a row here** — the store-load files predate this and were
backfilled by migration 002.

## Tests

`npm test` — node:test suites in `tests/`. Phase 1 seeds the harness with connection-string
resolver coverage; each later phase adds suites for its query layer.

## Acceptance criteria (all verified in browser against a production-replica DB)

- [x] Migrations run twice cleanly; kris = ADMIN, others FINANCE.
- [x] Top nav on every signed-in page incl. month-end tracker; not on login; active pillar highlights on legacy routes.
- [x] Five hub pages render from the registry; Operate hub shows freshness stamp.
- [x] Govern → Users & roles: ADMIN can create user, change role, reset password, deactivate/reactivate; non-ADMIN sees access notice; deactivated user cannot log in.
- [x] Self-lockout prevented (no self-demote / self-deactivate).
- [x] Logins and task ticks write audit events.
- [x] `npm test` green; `npm run build` green; existing dashboards unaffected.

## Operational notes

- The duplicate Vercel project `streamlit-app-py-68cm` must be deleted manually in the
  Vercel dashboard (Settings → General → Delete Project) — approved 20/07/2026.
- User management via `npm run create-user` still works but the Govern screen is now
  the preferred route (it assigns roles and writes audit events; the CLI does neither).

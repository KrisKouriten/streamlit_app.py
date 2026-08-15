-- Migration 105 — "Head of Department" role
-- Adds the HEAD role so department heads can be granted the reporting-protection
-- group (Finance / Exec / Head / Admin) that may view and download governed packs,
-- board packs and exports. Assignable in Users & Roles. Idempotent.
--
-- ROLLBACK:
--   DELETE FROM governance.user_role WHERE role_code = 'HEAD';
--   DELETE FROM governance.role WHERE role_code = 'HEAD';

INSERT INTO governance.role (role_code, role_name, description) VALUES
  ('HEAD', 'Head of Department', 'Department head — may view and download governed information, packs and exports.')
ON CONFLICT (role_code) DO NOTHING;

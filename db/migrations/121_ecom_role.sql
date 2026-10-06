-- Migration 121 — the ECOM role (HO-ECOM standalone access)
-- E-COM users get the ECOM role. They see the HO-ECOM section (E-COM
-- dashboard, daily trading, P&L / fees / marketing) and nothing else; Finance,
-- Exec and Admin see HO-ECOM as well. The keeping-to-HO-ECOM is enforced in the
-- middleware (lib/ecom-access.js), always on.
--
-- The app also creates this role itself the first time it is assigned
-- (lib/governance.js setUserRole), so it works whichever database branch this
-- file reaches. Idempotent.
--
-- ROLLBACK:
--   DELETE FROM governance.user_role WHERE role_code = 'ECOM';
--   DELETE FROM governance.role WHERE role_code = 'ECOM';

INSERT INTO governance.role (role_code, role_name, description) VALUES
  ('ECOM', 'E-COM', 'E-COM team — sees the HO-ECOM section only: E-COM dashboard, daily trading, P&L, fees and marketing.')
ON CONFLICT (role_code) DO NOTHING;

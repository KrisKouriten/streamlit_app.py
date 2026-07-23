-- Seed — Business Projects register (Plan — HO). Illustrative starter projects;
-- replace/extend via the in-app register. Idempotent (clears then inserts).

BEGIN;

DELETE FROM finance.business_project WHERE created_by = 'seed';

INSERT INTO finance.business_project (name, category, owner, status, rag, target_ym, budget, notes, created_by, updated_by) VALUES
  ('New store fit-out programme', 'Property', 'Retail Ops', 'Active', 'amber', '2026-11', 850000, 'Rolling fit-out of the FY26 store pipeline — sequencing against landlord handovers.', 'seed', 'seed'),
  ('EPOS platform upgrade', 'Technology', 'IT', 'Planned', 'green', '2027-03', 320000, 'Replace the legacy till system across all stores; phased by region.', 'seed', 'seed'),
  ('Warehouse automation phase 1', 'Supply Chain', 'Logistics', 'Active', 'red', '2026-09', 1200000, 'Pick-and-pack automation to cut goods-out cost per unit; supplier lead time slipping.', 'seed', 'seed'),
  ('Loyalty / CRM launch', 'Marketing', 'Commercial', 'Planned', 'green', '2027-01', 180000, 'Customer loyalty scheme and CRM to lift repeat purchase.', 'seed', 'seed');

COMMIT;

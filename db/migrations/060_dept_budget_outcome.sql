-- Migration 060 — Departmental Budgets: objective-driven expected outcome.
-- Builds on 051/059 (initiatives, objectives). Additive and idempotent.
--
-- The two fixed "expected incremental sales £ / margin £" inputs are replaced by a
-- single expected-outcome field whose meaning follows the chosen objective:
--   Increase Sales/Margin → £; Footfall → visits; Conversion → ppt; Engagement /
--   Brand Awareness → %; ECOM Traffic → sessions; Internal / Other → free text.
--
--   · outcome_value — the numeric expected outcome (null for free-text objectives)
--   · outcome_unit  — its unit at time of entry (£ / visits / ppt / % / sessions)
--   · outcome_note  — the free-text outcome for Internal-business / Other / custom
--
-- The existing incremental_sales / incremental_margin columns are kept and still
-- populated for the £ objectives (Sales → sales, Margin → margin), so the
-- commercial roll-up (contribution = margin − investment) and the report are
-- unchanged; the new columns carry the non-financial outcomes.
--
-- ROLLBACK:
--   ALTER TABLE finance.dept_budget_initiative
--     DROP COLUMN IF EXISTS outcome_value, DROP COLUMN IF EXISTS outcome_unit,
--     DROP COLUMN IF EXISTS outcome_note;

ALTER TABLE finance.dept_budget_initiative
  ADD COLUMN IF NOT EXISTS outcome_value numeric(16,4),
  ADD COLUMN IF NOT EXISTS outcome_unit  varchar(16),
  ADD COLUMN IF NOT EXISTS outcome_note  varchar(240);

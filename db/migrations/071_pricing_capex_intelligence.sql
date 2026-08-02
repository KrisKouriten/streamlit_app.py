-- Migration 071 — Pricing / Scenario / Capex into the Intelligence & Reporting layers
-- No new financial tables and no new calculations: this seeds the three new PLAN
-- modules (Pricing Review, Pricing Scenario, Capex Investment) into
--   (a) the AI page→domains registry, so AI Perspective runs on them and Finance
--       Buddy can cite them — the domains map to governed services wired in
--       lib/intelligence/retrieval.js (pricing / pricing_scenario / capex);
--   (b) the Corporate Reporting Centre, as three report templates whose sections
--       pull from the matching source adapters in lib/reporting/adapters.js
--       (pricing_review / pricing_scenario / capex).
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK (removes only these rows):
--   DELETE FROM finance.report_template_section WHERE template_id IN
--     (SELECT template_id FROM finance.report_template WHERE template_key IN ('PRICING_REVIEW_PACK','PRICING_SCENARIO_PACK','CAPEX_INVESTMENT_PACK'));
--   DELETE FROM finance.report_template WHERE template_key IN ('PRICING_REVIEW_PACK','PRICING_SCENARIO_PACK','CAPEX_INVESTMENT_PACK');
--   DELETE FROM intelligence.suggested_question   WHERE page_id IN ('pricing','pricing-scenario','capex');
--   DELETE FROM intelligence.page_relationship    WHERE page_id IN ('pricing','pricing-scenario','capex');
--   DELETE FROM intelligence.page_context_registry WHERE page_id IN ('pricing','pricing-scenario','capex');

BEGIN;

-- 1) AI page registry ----------------------------------------------------------
INSERT INTO intelligence.page_context_registry (page_id, page_name, route, note) VALUES
  ('pricing',          'Pricing Review',   '/plan/pricing',          'SKU cost build, margin and pricing health across the range.'),
  ('pricing-scenario', 'Pricing Scenario', '/plan/pricing-scenario', 'Promotion / markdown / clearance modelling — margin impact before implementation.'),
  ('capex',            'Capex Investment', '/plan/capex',            'Investment appraisal — IRR / NPV / payback, the 10-year model and capital allocation.')
ON CONFLICT (page_id) DO NOTHING;

INSERT INTO intelligence.page_relationship (page_id, domain, relation, display_order, note) VALUES
  ('pricing',          'pricing',          'PRIMARY', 1, NULL),
  ('pricing',          'sku',              'RELATED', 2, 'Sell-through and ranking behind the priced range.'),
  ('pricing',          'inventory',        'RELATED', 3, 'Cash invested in stock at the priced cost.'),

  ('pricing-scenario', 'pricing_scenario', 'PRIMARY', 1, NULL),
  ('pricing-scenario', 'pricing',          'RELATED', 2, 'Scenarios read cost + current price from the pricing master.'),
  ('pricing-scenario', 'finance_snapshot', 'RELATED', 3, 'Blended margin movement against the consolidated position.'),

  ('capex',            'capex',            'PRIMARY', 1, NULL),
  ('capex',            'cash',             'RELATED', 2, 'Investment draws on available cash.'),
  ('capex',            'business_projects','RELATED', 3, 'Delivery of the underlying projects.')
ON CONFLICT (page_id, domain) DO NOTHING;

-- suggested_question has no unique key on (page_id, display_order): clear then insert.
DELETE FROM intelligence.suggested_question WHERE page_id IN ('pricing','pricing-scenario','capex');

INSERT INTO intelligence.suggested_question (page_id, question, display_order) VALUES
  ('pricing', 'Which SKUs are priced below their target margin?', 1),
  ('pricing', 'Where is the biggest margin opportunity?', 2),
  ('pricing', 'How much cash is invested in stock at cost?', 3),

  ('pricing-scenario', 'What is the margin impact of the latest promotion?', 1),
  ('pricing-scenario', 'How much gross profit would this markdown cost?', 2),
  ('pricing-scenario', 'Which pricing scenarios are approved?', 3),

  ('capex', 'Which projects clear the hurdle rate?', 1),
  ('capex', 'What is the portfolio IRR and payback?', 2),
  ('capex', 'How much capital is still available to allocate?', 3);

-- 2) Reporting Centre templates ------------------------------------------------
INSERT INTO finance.report_template (template_key, name, purpose, audience, frequency, default_confidentiality, default_ai, effective_date, created_by)
VALUES
  ('PRICING_REVIEW_PACK', 'Pricing Review Pack',
   'The priced range for commercial review: average gross margin, cash invested in stock, the margin opportunity, and the SKUs sitting below their target margin.',
   'Commercial, Finance, SLT.', 'Monthly or on price review', 'CONFIDENTIAL',
   '["COMMERCIAL_FINANCE","FINANCE_DIRECTOR","OPPORTUNITY"]'::jsonb, CURRENT_DATE, 'migration 071'),
  ('PRICING_SCENARIO_PACK', 'Pricing Scenario Pack',
   'A promotion / markdown / clearance scenario before implementation: the blended margin movement (weighted by sales value), the gross-profit and cash effect, and the modelled SKU lines.',
   'Commercial, Finance Director, SLT.', 'On scenario submission', 'CONFIDENTIAL',
   '["COMMERCIAL_FINANCE","FPA","RISK"]'::jsonb, CURRENT_DATE, 'migration 071'),
  ('CAPEX_INVESTMENT_PACK', 'Capex Investment Pack',
   'The investment portfolio for capital-allocation sign-off: total investment, portfolio NPV / IRR / payback, the projects against the hurdle rate, and the capital-available position.',
   'Board, Finance Director, SLT.', 'Quarterly or on investment case', 'CONFIDENTIAL',
   '["FINANCE_DIRECTOR","CASH_TREASURY","RISK"]'::jsonb, CURRENT_DATE, 'migration 071')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO finance.report_template_section (template_id, section_key, title, position, mandatory, default_source_key, default_ai_perspective, default_page_type)
SELECT t.template_id, s.section_key, s.title, s.position, s.mandatory, s.src, s.persp, s.ptype
FROM finance.report_template t
CROSS JOIN (VALUES
  ('cover',    'Cover Page',            1, true,  NULL,             NULL,                'cover'),
  ('summary',  'Pricing Summary',       2, true,  'pricing_review', 'COMMERCIAL_FINANCE','exec_summary'),
  ('margin',   'Margin & Opportunity',  3, true,  'pricing_review', 'OPPORTUNITY',       'content')
) AS s(section_key, title, position, mandatory, src, persp, ptype)
WHERE t.template_key = 'PRICING_REVIEW_PACK'
ON CONFLICT (template_id, section_key) DO NOTHING;

INSERT INTO finance.report_template_section (template_id, section_key, title, position, mandatory, default_source_key, default_ai_perspective, default_page_type)
SELECT t.template_id, s.section_key, s.title, s.position, s.mandatory, s.src, s.persp, s.ptype
FROM finance.report_template t
CROSS JOIN (VALUES
  ('cover',     'Cover Page',           1, true,  NULL,               NULL,                'cover'),
  ('summary',   'Scenario Summary',     2, true,  'pricing_scenario', 'COMMERCIAL_FINANCE','exec_summary'),
  ('lines',     'Modelled SKU Lines',   3, true,  'pricing_scenario', 'FPA',               'content')
) AS s(section_key, title, position, mandatory, src, persp, ptype)
WHERE t.template_key = 'PRICING_SCENARIO_PACK'
ON CONFLICT (template_id, section_key) DO NOTHING;

INSERT INTO finance.report_template_section (template_id, section_key, title, position, mandatory, default_source_key, default_ai_perspective, default_page_type)
SELECT t.template_id, s.section_key, s.title, s.position, s.mandatory, s.src, s.persp, s.ptype
FROM finance.report_template t
CROSS JOIN (VALUES
  ('cover',       'Cover Page',              1, true,  NULL,    NULL,               'cover'),
  ('summary',     'Portfolio Summary',       2, true,  'capex', 'FINANCE_DIRECTOR', 'exec_summary'),
  ('projects',    'Projects vs Hurdle',      3, true,  'capex', 'RISK',             'content')
) AS s(section_key, title, position, mandatory, src, persp, ptype)
WHERE t.template_key = 'CAPEX_INVESTMENT_PACK'
ON CONFLICT (template_id, section_key) DO NOTHING;

COMMIT;

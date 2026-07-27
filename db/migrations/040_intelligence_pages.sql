-- Migration 040 — Finance Intelligence Layer, Phase 4 (wider module coverage)
-- Seeds seven more governed pages into the page→domains registry so AI
-- Perspective can run on them and Finance Buddy can cite them. No new tables and
-- no new financial calculations: the domains map to existing calculation
-- services wired in lib/intelligence/retrieval.js. Additive and idempotent.
--
-- Groups: Trading & commercial (procurement, sku-analysis),
--         Position & close (three-statement, month-end-close, intercompany),
--         Planning (scenarios, business-projects).
--
-- ROLLBACK (removes only these Phase-4 rows):
--   DELETE FROM intelligence.suggested_question WHERE page_id IN
--     ('procurement','sku-analysis','three-statement','month-end-close','intercompany','scenarios','business-projects');
--   DELETE FROM intelligence.page_relationship  WHERE page_id IN (... same ...);
--   DELETE FROM intelligence.page_context_registry WHERE page_id IN (... same ...);

BEGIN;

INSERT INTO intelligence.page_context_registry (page_id, page_name, route, note) VALUES
  ('procurement',      'Procurement',          '/operate/procurement',        'Miniso / local purchasing, cash budget vs supplier terms.'),
  ('sku-analysis',     'SKU Analysis',         '/finance-os/sku-analysis',    '80/20 Pareto, new SKUs, dormant stock.'),
  ('three-statement',  'Three-Statement',      '/finance-os/three-statement', 'P&L, balance sheet and indirect cash flow, tied together.'),
  ('month-end-close',  'Month-end Close',      '/operate/close',              'Pre-close exceptions and close readiness.'),
  ('intercompany',     'Intercompany',         '/operate/intercompany',       'Intercompany cash, recharges and disbursements; reconciliation.'),
  ('scenarios',        'Scenario Planning',    '/plan/scenarios',             'Working forecast scenarios — sales / cost flex to EBITDA.'),
  ('business-projects','Business Projects',    '/plan/business-projects',     'HO project register — status, RAG and budget.')
ON CONFLICT (page_id) DO NOTHING;

INSERT INTO intelligence.page_relationship (page_id, domain, relation, display_order, note) VALUES
  ('procurement',       'procurement',        'PRIMARY', 1, NULL),
  ('procurement',       'cash',               'RELATED', 2, 'Committed spend vs supplier terms drives the cash outflow profile.'),
  ('procurement',       'management_accounts','RELATED', 3, NULL),

  ('sku-analysis',      'sku',                'PRIMARY', 1, NULL),
  ('sku-analysis',      'inventory',          'RELATED', 2, 'Dormant SKUs tie up stock value.'),
  ('sku-analysis',      'store_performance',  'RELATED', 3, NULL),

  ('three-statement',   'three_statement',    'PRIMARY', 1, NULL),
  ('three-statement',   'finance_snapshot',   'RELATED', 2, NULL),
  ('three-statement',   'cash',               'RELATED', 3, NULL),

  ('month-end-close',   'close_status',       'PRIMARY', 1, NULL),
  ('month-end-close',   'management_accounts','RELATED', 2, NULL),
  ('month-end-close',   'finance_snapshot',   'RELATED', 3, NULL),

  ('intercompany',      'intercompany',       'PRIMARY', 1, NULL),
  ('intercompany',      'cash',               'RELATED', 2, NULL),

  ('scenarios',         'scenarios',          'PRIMARY', 1, NULL),
  ('scenarios',         'finance_snapshot',   'RELATED', 2, 'Base case vs the consolidated actuals.'),
  ('scenarios',         'store_performance',  'RELATED', 3, NULL),

  ('business-projects', 'business_projects',  'PRIMARY', 1, NULL),
  ('business-projects', 'management_accounts','RELATED', 2, NULL)
ON CONFLICT (page_id, domain) DO NOTHING;

-- suggested_question has no unique key on (page_id, display_order), so make the
-- seed idempotent by clearing these (new) page_ids first, then inserting.
DELETE FROM intelligence.suggested_question WHERE page_id IN
  ('procurement','sku-analysis','three-statement','month-end-close','intercompany','scenarios','business-projects');

INSERT INTO intelligence.suggested_question (page_id, question, display_order) VALUES
  ('procurement', 'Are we within the procurement budget?', 1),
  ('procurement', 'Which suppliers carry the most committed spend?', 2),
  ('procurement', 'How do payment terms shape the cash outflow?', 3),

  ('sku-analysis', 'Which SKUs drive 80% of revenue?', 1),
  ('sku-analysis', 'How much stock value is tied up in dormant SKUs?', 2),
  ('sku-analysis', 'How are the new SKUs performing?', 3),

  ('three-statement', 'Does the cash flow reconcile to the balance sheet?', 1),
  ('three-statement', 'What drove the movement in cash this period?', 2),
  ('three-statement', 'Summarise the financial position.', 3),

  ('month-end-close', 'What is outstanding before we can close?', 1),
  ('month-end-close', 'Which pre-close exceptions need attention?', 2),
  ('month-end-close', 'Are we ready to lock the period?', 3),

  ('intercompany', 'How much intercompany is unreconciled?', 1),
  ('intercompany', 'Summarise the intercompany position.', 2),
  ('intercompany', 'Which balances still need reconciling?', 3),

  ('scenarios', 'What happens to EBITDA if sales fall?', 1),
  ('scenarios', 'Compare the base case to the downside.', 2),
  ('scenarios', 'Which assumption moves EBITDA most?', 3),

  ('business-projects', 'Which projects are flagged red?', 1),
  ('business-projects', 'What is our total project budget commitment?', 2),
  ('business-projects', 'Which active projects need attention?', 3)
ON CONFLICT (page_id, display_order) DO NOTHING;

COMMIT;

-- Migration 067 — Open-to-Buy AI page context + suggested questions
-- Registers the OTB workspace with the Intelligence Layer so AI Perspective on the
-- page resolves the merchandising OTB domain, and seeds the suggested questions the
-- change request lists. Finance Buddy already reaches OTB via keyword routing.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DELETE FROM intelligence.suggested_question WHERE page_id = 'open-to-buy';
--   DELETE FROM intelligence.page_relationship WHERE page_id = 'open-to-buy';
--   DELETE FROM intelligence.page_context_registry WHERE page_id = 'open-to-buy';

BEGIN;

INSERT INTO intelligence.page_context_registry (page_id, page_name, route, note)
VALUES ('open-to-buy', 'Open-to-Buy', '/plan/otb', 'Merchandising OTB by channel — sales reconciliation, inventory, commitments and remaining spend.')
ON CONFLICT (page_id) DO NOTHING;

INSERT INTO intelligence.page_relationship (page_id, domain, relation, display_order) VALUES
  ('open-to-buy', 'otb_merchandising', 'PRIMARY', 0),
  ('open-to-buy', 'inventory',         'RELATED', 1),
  ('open-to-buy', 'procurement',       'RELATED', 2),
  ('open-to-buy', 'store_performance', 'RELATED', 3)
ON CONFLICT (page_id, domain) DO NOTHING;

INSERT INTO intelligence.suggested_question (page_id, question, display_order) VALUES
  ('open-to-buy', 'How much OTB remains for Miniso MDS and Local Purchase?', 0),
  ('open-to-buy', 'Which procurement requests exceed OTB?', 1),
  ('open-to-buy', 'Is the combined sales forecast within tolerance of the approved plan?', 2),
  ('open-to-buy', 'What stock should be transferred or cleared before more is purchased?', 3),
  ('open-to-buy', 'What is the impact of new-store openings on OTB?', 4)
ON CONFLICT DO NOTHING;

COMMIT;

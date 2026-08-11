-- Migration 096 — Executive hub AI Perspective leads with the live store feed
-- The Executive Intelligence Hub foregrounds the live store-sales feed (revenue
-- and gross margin, all stores) at the top of the page. Its AI Perspective was
-- configured to LEAD with the consolidated P&L (finance_snapshot) — a
-- period-lagged Joiin feed that is empty between refreshes — so the commentary
-- fixated on "£0 / data unavailable" instead of analysing the trading figures
-- actually shown on the page. Promote store_performance to the PRIMARY basis and
-- demote finance_snapshot to a RELATED input, so the AI analyses the same live
-- headline the user sees. Idempotent (plain UPDATEs).
--
-- Down (manual): restore finance_snapshot PRIMARY / store_performance RELATED.

UPDATE intelligence.page_relationship
   SET relation = 'RELATED', display_order = 2
 WHERE page_id = 'executive' AND domain = 'finance_snapshot';

UPDATE intelligence.page_relationship
   SET relation = 'PRIMARY', display_order = 1,
       note = 'Live store-sales feed — the trading headline shown on the hub.'
 WHERE page_id = 'executive' AND domain = 'store_performance';

UPDATE intelligence.page_relationship
   SET display_order = 3
 WHERE page_id = 'executive' AND domain = 'management_accounts';

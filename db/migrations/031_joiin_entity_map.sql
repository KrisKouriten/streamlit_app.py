-- Migration 031 — Joiin entity map in the database (Phase 29, Tier 1 item 8)
-- Moves the company-name → Joiin-id map out of hardcoded lib/entity-map.js and
-- into a table, so a new/closed company can be added or retired without a code
-- change. Seeded from the current constant, so behaviour is identical on day
-- one; the app falls back to the constant if this table is absent or empty.
-- The names are the LEGAL entities exactly as they appear in Joiin (they are
-- functional API keys) — deliberately not relabelled. Additive and idempotent.
--
-- ROLLBACK: DROP TABLE IF EXISTS finance.joiin_entity_map;

BEGIN;

CREATE TABLE IF NOT EXISTS finance.joiin_entity_map (
  entity_name  varchar(160) PRIMARY KEY,   -- Joiin company name (the API key)
  joiin_id     varchar(64)  NOT NULL,       -- Joiin company UUID
  scope        varchar(20),                 -- optional hint: store/head_office/franchise/…
  active       boolean      NOT NULL DEFAULT true,
  sort_order   integer      NOT NULL DEFAULT 0,
  created_at   timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO finance.joiin_entity_map (entity_name, joiin_id) VALUES
  ('Kouriten West London Limited', '86d2eaa0-5c51-11ee-bab0-9b6377819a7b'),
  ('Kouriten Stores Limited',      '78b0e460-720f-11f0-9643-cd6865c61629'),
  ('Kouriten Shaftesbury Limited', 'ec0d39e0-66a9-11ee-a3ff-f9ffd1c421bf'),
  ('Kouriten Oxford Street Ltd',   '4d640f90-9821-11ee-a71c-a3b704e0f3e5'),
  ('Kouriten Oxford Limited',      '87c5fd30-5c51-11ee-bab0-9b6377819a7b'),
  ('Kouriten Outlet Limited',      '5fc4a990-b0c3-11ef-b508-fde00db1d925'),
  ('Kouriten Nottingham Limited',  '886c0130-5c51-11ee-bab0-9b6377819a7b'),
  ('Kouriten Meadowhall Limited',  'e31ac500-bfdf-11f0-9386-9f5651cf283d'),
  ('Kouriten Luton Limited',       '254142c0-e236-11ef-8cd9-4724f1e97c63'),
  ('Kouriten Leeds Limited',       '87ef0900-5c51-11ee-bab0-9b6377819a7b'),
  ('Kouriten Kingston Limited',    '24fc7190-e236-11ef-8cd9-4724f1e97c63'),
  ('Kouriten Eastbourne Limited',  '5fed4030-b0c3-11ef-b508-fde00db1d925'),
  ('Kouriten Ealing Limited',      '857a8690-5c51-11ee-bab0-9b6377819a7b'),
  ('Kouriten Castle Ltd',          '600c12d0-b0c3-11ef-b508-fde00db1d925'),
  ('Kouriten Cardiff Limited',     '878f35c0-5c51-11ee-bab0-9b6377819a7b'),
  ('Kouriten Camden Ltd',          '6bd75010-d0cd-11ee-a002-abfc6416826b'),
  ('Kouriten Cambridge Limited',   '876566a0-5c51-11ee-bab0-9b6377819a7b'),
  ('Kouriten Caledonia Limited',   '81380050-269c-11f0-a696-4143a9f0fc38'),
  ('Kouriten Brighton Limited',    '873025d0-5c51-11ee-bab0-9b6377819a7b'),
  ('Kouriten Brent Cross Limited', '86098020-5c51-11ee-bab0-9b6377819a7b'),
  ('Kouriten Ltd E-COM',           '6bb08e30-d0cd-11ee-a002-abfc6416826b'),
  ('Kouriten Franchise Limited',   '8532cf30-5c51-11ee-bab0-9b6377819a7b'),
  ('Kouriten Limited',             '87078f30-5c51-11ee-bab0-9b6377819a7b'),
  ('Kouriten Holdings Limited',    'ae656140-e52e-11ee-b816-b3be153c8006'),
  ('New Kouriten Stores',          '251ddc40-e236-11ef-8cd9-4724f1e97c63'),
  ('Kouriten Group Cashflow',      '4e0eb190-946c-11f0-8417-8961218bd229')
ON CONFLICT (entity_name) DO NOTHING;

COMMIT;

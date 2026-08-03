-- Migration 077 — Treasury section schema + seeded HSBC bank trade facility.
-- The Treasury desk brings together the bank trade facility (HSBC TradePay + post-
-- shipment buyer loans), a bank term loan register, FX hedging contracts, the sales
-- income streams (retail / wholesale / franchise) and store cash reconciliations.
-- The bank trade facility is seeded from Finance's HSBC facility extract; the other
-- registers start empty and are filled by manual entry or CSV upload.
--
-- Additive and idempotent. Safe to re-run. The seed only inserts on first run
-- (ON CONFLICT (reference) DO NOTHING).
--
-- ROLLBACK: DROP the finance.bank_trade_facility / bank_term_loan / hedging_contract
-- / sales_income / store_cash_recon tables.

BEGIN;

CREATE TABLE IF NOT EXISTS finance.bank_trade_facility (
  id                    bigserial PRIMARY KEY,
  reference             varchar(40) UNIQUE,
  beneficiary           varchar(180),
  customer_reference    varchar(160),
  payment_currency      varchar(4),
  loan_amount           numeric(18,2),
  loan_currency         varchar(4),
  outstanding_amount    numeric(18,2),
  status                varchar(40),
  extension_settlement  varchar(80),
  product_type          varchar(80),         -- HSBC TradePay / Post-shipment buyer loan
  loan_start_date       date,
  due_date              date,
  loan_period_days      int,
  payment_amount        numeric(18,2),        -- in payment currency
  payment_month         date,                 -- first of the settlement month
  facility_payment_gbp  numeric(18,2),        -- GBP-equivalent cash-out
  cost_driver           varchar(60),          -- Opex / Capex / Local Purchase / Miniso LC's / …
  source_tag            varchar(30) NOT NULL DEFAULT 'HSBC upload',
  created_at            timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_trade_facility_month ON finance.bank_trade_facility (payment_month);

CREATE TABLE IF NOT EXISTS finance.bank_term_loan (
  id                bigserial PRIMARY KEY,
  lender            varchar(120) NOT NULL,
  reference         varchar(80),
  facility_type     varchar(60),              -- Term loan / RCF / Overdraft
  currency          varchar(4) NOT NULL DEFAULT 'GBP',
  principal_gbp     numeric(18,2) NOT NULL DEFAULT 0,
  balance_gbp       numeric(18,2) NOT NULL DEFAULT 0,
  interest_rate     numeric(9,4),             -- annual %
  rate_basis        varchar(40),              -- Fixed / SONIA + margin
  drawdown_date     date,
  maturity_date     date,
  repayment         varchar(60),              -- Bullet / Amortising / Interest-only
  notes             text,
  updated_by        varchar(160),
  updated_at        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance.hedging_contract (
  id                bigserial PRIMARY KEY,
  instrument        varchar(40) NOT NULL,     -- FX Forward / Option / Swap
  pair              varchar(12),              -- e.g. GBPUSD
  notional          numeric(18,2) NOT NULL DEFAULT 0,
  notional_ccy      varchar(4),
  rate              numeric(14,6),            -- contracted rate
  trade_date        date,
  value_date        date,
  counterparty      varchar(120),
  purpose           varchar(120),             -- what exposure it hedges
  mtm_gbp           numeric(18,2),            -- mark-to-market
  status            varchar(30) NOT NULL DEFAULT 'OPEN',   -- OPEN / SETTLED / CANCELLED
  notes             text,
  updated_by        varchar(160),
  updated_at        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance.sales_income (
  id            bigserial PRIMARY KEY,
  stream        varchar(20) NOT NULL,          -- RETAIL / WHOLESALE / FRANCHISE
  period        char(7) NOT NULL,              -- YYYY-MM
  amount_gbp    numeric(18,2) NOT NULL DEFAULT 0,
  received_gbp  numeric(18,2),                 -- cash received (for reconciliation)
  notes         text,
  source_tag    varchar(30) NOT NULL DEFAULT 'MANUAL',
  updated_by    varchar(160),
  updated_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (stream, period)
);

CREATE TABLE IF NOT EXISTS finance.store_cash_recon (
  id            bigserial PRIMARY KEY,
  store_code    varchar(40) NOT NULL,
  store_name    varchar(120),
  period        char(7) NOT NULL,              -- YYYY-MM
  expected_cash numeric(18,2) NOT NULL DEFAULT 0,  -- till / system takings
  banked_cash   numeric(18,2) NOT NULL DEFAULT 0,  -- actually banked
  status        varchar(30) NOT NULL DEFAULT 'OPEN',   -- OPEN / RECONCILED / EXCEPTION
  notes         text,
  updated_by    varchar(160),
  updated_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_code, period)
);

-- Seed the HSBC bank trade facility from Finance's extract.
INSERT INTO finance.bank_trade_facility
  (reference, beneficiary, customer_reference, payment_currency, loan_amount, loan_currency,
   outstanding_amount, status, extension_settlement, product_type, loan_start_date, due_date,
   loan_period_days, payment_amount, payment_month, facility_payment_gbp, cost_driver)
VALUES
  ('WCTUKA085607','Nine Impressions','9IMPRESSTP220726','GBP',44684.4,'GBP',44684.4,'Disbursed','-','HSBC TradePay','2026-07-22','2027-01-18',180,44684.4,'2027-01-01',44684.4,'Opex'),
  ('WCTUKA085541','Savills (UK) Ltd','SavillsTP220726','GBP',58241.87,'GBP',58241.87,'Disbursed','-','HSBC TradePay','2026-07-22','2027-01-06',168,58241.87,'2027-01-01',58241.87,'Opex'),
  ('WCTUKA085334','Design Signage Solution','DesignSiTP210726','GBP',31261.56,'GBP',31261.56,'Disbursed','-','HSBC TradePay','2026-07-21','2027-01-06',169,31261.56,'2027-01-01',31261.56,'Capex'),
  ('WCTUKA084913','B Batch Limited','BBATCHTP170726','GBP',23102.44,'GBP',23102.44,'Disbursed','-','HSBC TradePay','2026-07-17','2027-01-13',180,23102.44,'2027-01-01',23102.44,'Capex'),
  ('WCTUKA084823','GXO LOGISTICS UK LIMITED','GXOTP170726','GBP',276882.32,'GBP',276882.32,'Disbursed','-','HSBC TradePay','2026-07-17','2026-12-24',160,276882.32,'2026-12-01',276882.32,'Opex'),
  ('WCTUKA084514','Ashbridge Interiors Ltd','ASHBRIDTP160726','GBP',107426.16,'GBP',107426.16,'Disbursed','-','HSBC TradePay','2026-07-16','2027-01-12',180,107426.16,'2027-01-01',107426.16,'Local Purchase'),
  ('WCTUKA084446','MINISO INVESTMENT HONG KONG LIMITED','MINISOINVT150726','GBP',95654.79,'GBP',95654.79,'Disbursed','-','HSBC TradePay','2026-07-16','2027-01-11',179,95654.79,'2027-01-01',95654.79,'Miniso Investment'),
  ('WCTUKA084466','Design360 Limited','Desi360TP150726','GBP',41566.43,'GBP',41566.43,'Disbursed','-','HSBC TradePay','2026-07-16','2026-12-31',168,41566.43,'2026-12-01',41566.43,'Capex'),
  ('LAIUK1084010','Miniso','LC92A 05.06.26 2/3','USD',191040.18,'USD',191040.18,'Disbursed','-','Post-shipment buyer loan','2026-07-15','2027-01-11',180,191040.18,'2027-01-01',142567.29850746266,'Miniso LC''s'),
  ('WCTUKA084424','TOP TOY HK LIMITED','TopToyTP150726','USD',79576.9,'USD',79576.9,'Disbursed','-','HSBC TradePay','2026-07-15','2027-01-11',180,79576.9,'2027-01-01',59385.74626865671,'Local Purchase'),
  ('WCTUKA083703','Korea Foods Limited','KoreaFooTP100726','GBP',13899.3,'GBP',13899.3,'Disbursed','-','HSBC TradePay','2026-07-10','2027-01-05',179,13899.3,'2027-01-01',13899.3,'Local Purchase'),
  ('WCTUKA083700','DKB Toys and Distribution Ltd','DKBTOYSTP100726','GBP',22498.56,'GBP',22498.56,'Disbursed','-','HSBC TradePay','2026-07-10','2027-01-06',180,22498.56,'2027-01-01',22498.56,'Local Purchase'),
  ('WCTUKA083698','STAR ORIENTAL TRADING LTD','StarOrieTP100726','GBP',14747.28,'GBP',14747.28,'Disbursed','-','HSBC TradePay','2026-07-10','2026-12-31',174,14747.28,'2026-12-01',14747.28,'Local Purchase'),
  ('WCTUKA083691','Tokidoki','TOKIDOKITP100726','USD',23778.63,'USD',23778.63,'Disbursed','-','HSBC TradePay','2026-07-10','2026-12-31',174,23778.63,'2026-12-01',17745.246268656716,'Local Purchase'),
  ('WCTUKA083694','One For Fun Limited','ONEFORFUTP100726','GBP',16551.5,'GBP',16551.5,'Disbursed','-','HSBC TradePay','2026-07-10','2026-12-31',174,16551.5,'2026-12-01',16551.5,'Local Purchase'),
  ('WCTUKA083688','Unisnacks Europe Ltd','UnisnackTP100726','GBP',33591.75,'GBP',33591.75,'Disbursed','-','HSBC TradePay','2026-07-10','2027-01-06',180,33591.75,'2027-01-01',33591.75,'Local Purchase'),
  ('WCTUKA083678','B Batch Limited','BBATCHTP100726','GBP',49250.9,'GBP',49250.9,'Disbursed','-','HSBC TradePay','2026-07-10','2027-01-06',180,49250.9,'2027-01-01',49250.9,'Capex'),
  ('LAIUK1083518','Miniso','LC91A 04.06.26 1/3','USD',112693.46,'USD',112693.46,'Disbursed','-','Post-shipment buyer loan','2026-07-10','2027-01-06',180,112693.46,'2027-01-01',84099.59701492537,'Miniso LC''s'),
  ('LAIUK1083525','Miniso','LC92A 05.06.26 3/3','USD',119782.61,'USD',119782.61,'Disbursed','-','Post-shipment buyer loan','2026-07-10','2027-01-06',180,119782.61,'2027-01-01',89390.00746268657,'Miniso LC''s'),
  ('LAIUK1083406','Miniso','LC92A 05.06.26 3/3','USD',74904.74,'USD',74904.74,'Disbursed','-','Post-shipment buyer loan','2026-07-09','2027-01-05',180,74904.74,'2027-01-01',55899.05970149254,'Miniso LC''s'),
  ('WCTUKA083000','Mighty Jaxx','MightyTP070726','USD',36316.8,'USD',36316.8,'Disbursed','-','HSBC TradePay','2026-07-08','2026-12-30',175,36316.8,'2026-12-01',27102.089552238805,'Local Purchase'),
  ('WCTUKA082546','Esdevium Games Limited','ESDEVIUMTP030726','GBP',12000,'GBP',12000,'Disbursed','-','HSBC TradePay','2026-07-06','2026-12-30',177,12000,'2026-12-01',12000,'Local Purchase'),
  ('WCTUKA082533','Pinnaca Solutions Limited','PinnacaTP030726','GBP',49640,'GBP',49640,'Disbursed','-','HSBC TradePay','2026-07-03','2026-12-30',180,49640,'2026-12-01',49640,'Capex'),
  ('WCTUKA082528','Korea Foods Limited','KoreaFooTP030726','GBP',22303.56,'GBP',22303.56,'Disbursed','-','HSBC TradePay','2026-07-03','2026-12-24',174,22303.56,'2026-12-01',22303.56,'Local Purchase'),
  ('LAIUK1082310','Miniso','LC91A 04.06.26 3/3','USD',152384.85,'USD',152384.85,'Disbursed','-','Post-shipment buyer loan','2026-07-03','2026-12-30',180,152384.85,'2026-12-01',113720.03731343284,'Miniso LC''s'),
  ('WCTUKA082389','COLLECT AND DISPLAY LIMITED','CollDispTP030726','GBP',29250,'GBP',29250,'Disbursed','-','HSBC TradePay','2026-07-03','2026-12-30',180,29250,'2026-12-01',29250,'Local Purchase'),
  ('LAIUK1080844','Miniso','LC91A 04.06.26 2/3','USD',169837.82,'USD',169837.82,'Disbursed','-','Post-shipment buyer loan','2026-07-01','2026-12-29',181,169837.82,'2026-12-01',126744.64179104478,'Miniso LC''s'),
  ('LAIUK1081800','Miniso','LC92A 05.06.26 1/3','USD',181369.68,'USD',181369.68,'Disbursed','-','Post-shipment buyer loan','2026-07-01','2026-12-29',181,181369.68,'2026-12-01',135350.50746268657,'Miniso LC''s'),
  ('WCTUKA081724','Esdevium Games Limited','ESDEVIUMTP300626','GBP',46207.68,'GBP',46207.68,'Disbursed','-','HSBC TradePay','2026-06-30','2026-12-23',176,46207.68,'2026-12-01',46207.68,'Local Purchase'),
  ('WCTUKA081506','LAZARI LIMITED','LazariTP290626','GBP',181500,'GBP',181500,'Disbursed','-','HSBC TradePay','2026-06-30','2026-12-24',177,181500,'2026-12-01',181500,'Opex'),
  ('WCTUKA081516','GXO LOGISTICS UK LIMITED','GXOTP290626','GBP',72294.14,'GBP',72294.14,'Disbursed','-','HSBC TradePay','2026-06-30','2026-12-24',177,72294.14,'2026-12-01',72294.14,'Opex'),
  ('WCTUKA081336','Levy Asset Management Ltd','LEVYASSETP290626','GBP',121500,'GBP',121500,'Disbursed','-','HSBC TradePay','2026-06-29','2026-12-24',178,121500,'2026-12-01',121500,'Opex'),
  ('WCTUKA081262','World of Sweets','WorldofSTP260626','GBP',18762,'GBP',18762,'Disbursed','-','HSBC TradePay','2026-06-26','2026-12-23',180,18762,'2026-12-01',18762,'Local Purchase'),
  ('WCTUKA080942','Bandai UK Limited','BandaiTP250626','GBP',21759.98,'GBP',21759.98,'Disbursed','-','HSBC TradePay','2026-06-25','2026-12-22',180,21759.98,'2026-12-01',21759.98,'Local Purchase'),
  ('LAIUK1080849','Miniso','LC91A 04.06.26 1/3','USD',103910.7,'USD',103910.7,'Disbursed','-','Post-shipment buyer loan','2026-06-25','2026-12-22',180,103910.7,'2026-12-01',77545.29850746268,'Miniso LC''s'),
  ('WCTUKA080630','Link Integrated Security Solutions','LinkedInTP240626','GBP',13432.59,'GBP',13432.59,'Disbursed','-','HSBC TradePay','2026-06-24','2026-12-16',175,13432.59,'2026-12-01',13432.59,'Capex'),
  ('WCTUKA080493','FINIECO','FINIECOTP230626','EUR',31642.8,'EUR',31642.8,'Disbursed','-','HSBC TradePay','2026-06-23','2026-12-18',178,31642.8,'2026-12-01',31642.8,'Local Purchase'),
  ('WCTUKA080005','STAR ORIENTAL TRADING LTD','STARORITP190626','GBP',13413.88,'GBP',13413.88,'Disbursed','-','HSBC TradePay','2026-06-19','2026-12-16',180,13413.88,'2026-12-01',13413.88,'Local Purchase'),
  ('WCTUKA080004','Bubble T Cosmetics Ltd','BUBBLETTP190626','GBP',14800.74,'GBP',14800.74,'Disbursed','-','HSBC TradePay','2026-06-19','2026-12-11',175,14800.74,'2026-12-01',14800.74,'Local Purchase'),
  ('WCTUKA080002','A B Gee of Ripley Ltd','ABGEETP190626','GBP',29559.82,'GBP',29559.82,'Disbursed','-','HSBC TradePay','2026-06-19','2026-12-16',180,29559.82,'2026-12-01',29559.82,'Local Purchase'),
  ('WCTUKA079999','Epoch-Making Toys Ltd','EPOCHTP190626','GBP',36460.8,'GBP',36460.8,'Disbursed','-','HSBC TradePay','2026-06-19','2026-12-11',175,36460.8,'2026-12-01',36460.8,'Local Purchase'),
  ('WCTUKA079990','B Batch Limited','BBATCHTP190626','GBP',87433.1,'GBP',87433.1,'Disbursed','-','HSBC TradePay','2026-06-19','2026-12-09',173,87433.1,'2026-12-01',87433.1,'Capex'),
  ('LAIUK1079580','Miniso','LC90A 20.05.26 2/3','USD',172790.88,'USD',172790.88,'Disbursed','-','Post-shipment buyer loan','2026-06-17','2026-12-14',180,172790.88,'2026-12-01',128948.41791044775,'Miniso LC''s'),
  ('LAIUK1079543','Miniso','LC90A 20.05.26 1/3','USD',160488.22,'USD',160488.22,'Disbursed','-','Post-shipment buyer loan','2026-06-17','2026-12-14',180,160488.22,'2026-12-01',119767.32835820895,'Miniso LC''s'),
  ('LAIUK1079512','Miniso','LC89 13.05.26 1/3','USD',206711.46,'USD',206711.46,'Disbursed','-','Post-shipment buyer loan','2026-06-17','2026-12-14',180,206711.46,'2026-12-01',154262.28358208953,'Miniso LC''s'),
  ('LAIUK1079503','Miniso','LC90A 20.05.26 3/3','USD',201543,'USD',201543,'Disbursed','-','Post-shipment buyer loan','2026-06-17','2026-12-14',180,201543,'2026-12-01',150405.223880597,'Miniso LC''s'),
  ('WCTUKA079544','GXO LOGISTICS UK LIMITED','GXO290526','GBP',314628.33,'GBP',314628.33,'Disbursed','-','HSBC TradePay','2026-06-17','2026-12-09',175,314628.33,'2026-12-01',314628.33,'Opex'),
  ('WCTUKA079542','Bandai UK Limited','BANDAITP170626','GBP',36162,'GBP',36162,'Disbursed','-','HSBC TradePay','2026-06-17','2026-12-09',175,36162,'2026-12-01',36162,'Local Purchase'),
  ('LAIUK1078183','Miniso','LC89C 13.05.26 3/3','USD',197426.6,'USD',197426.6,'Disbursed','-','Post-shipment buyer loan','2026-06-09','2026-12-07',181,197426.6,'2026-12-01',147333.28358208956,'Miniso LC''s'),
  ('LAIUK1078180','Miniso','LC89 13.05.26 1/3','USD',186185.19,'USD',186185.19,'Disbursed','-','Post-shipment buyer loan','2026-06-09','2026-12-07',181,186185.19,'2026-12-01',138944.17164179104,'Miniso LC''s'),
  ('LAIUK1078182','Miniso','LC89C 13.05.26 3/3','USD',34452,'USD',34452,'Disbursed','-','Post-shipment buyer loan','2026-06-09','2026-12-07',181,34452,'2026-12-01',25710.447761194027,'Miniso LC''s'),
  ('LAIUK1077823','Miniso','LC88 29.04.26 2/3','USD',188774.42,'USD',188774.42,'Disbursed','-','Post-shipment buyer loan','2026-06-08','2026-12-07',182,188774.42,'2026-12-01',140876.4328358209,'Miniso LC''s'),
  ('LAIUK1077956','Miniso','LC88 29.04.26 1/3','USD',186968.43,'USD',186968.43,'Disbursed','-','Post-shipment buyer loan','2026-06-08','2026-12-07',182,186968.43,'2026-12-01',139528.6791044776,'Miniso LC''s'),
  ('LAIUK1077833','Miniso','LC88 29.04.26 1/3','USD',1737.11,'USD',1737.11,'Disbursed','-','Post-shipment buyer loan','2026-06-05','2026-12-02',180,1737.11,'2026-12-01',1296.3507462686566,'Miniso LC''s'),
  ('LAIUK1077698','Miniso','LC88 29.04.26 3/3','USD',58977.5,'USD',58977.5,'Disbursed','-','Post-shipment buyer loan','2026-06-05','2026-12-02',180,58977.5,'2026-12-01',44013.05970149254,'Miniso LC''s'),
  ('LAIUK1077584','Miniso','LC88 29.04.26 3/3','USD',132603.84,'USD',132603.84,'Disbursed','-','Post-shipment buyer loan','2026-06-04','2026-12-01',180,132603.84,'2026-12-01',98958.0895522388,'Miniso LC''s'),
  ('WCTUKA077477','Pyramid International','PYRAMIDTP040626','GBP',7896,'GBP',7896,'Disbursed','-','HSBC TradePay','2026-06-04','2026-12-01',180,7896,'2026-12-01',7896,'Opex'),
  ('WCTUKA077474','Digi East Wholesale LTD','DIGIEASTTP040626','GBP',14024.32,'GBP',14024.32,'Disbursed','-','HSBC TradePay','2026-06-04','2026-12-01',180,14024.32,'2026-12-01',14024.32,'Local Purchase'),
  ('WCTUKA077472','ASCO Foods Limited','ASCOTP040626','GBP',28259.09,'GBP',28259.09,'Disbursed','-','HSBC TradePay','2026-06-04','2026-12-01',180,28259.09,'2026-12-01',28259.09,'Local Purchase'),
  ('WCTUKA077281','KOHLICO Brands UK Ltd','KOHLICOTP030626','GBP',11276.4,'GBP',11276.4,'Disbursed','-','HSBC TradePay','2026-06-03','2026-11-25',175,11276.4,'2026-11-01',11276.4,'Local Purchase'),
  ('WCTUKA077279','Heathside','HeathsidTP030626','GBP',25670.88,'GBP',25670.88,'Disbursed','-','HSBC TradePay','2026-06-03','2026-11-30',180,25670.88,'2026-11-01',25670.88,'Local Purchase'),
  ('WCTUKA077256','Rand Diffusion','RANDTP030626','GBP',39264.16,'GBP',39264.16,'Disbursed','-','HSBC TradePay','2026-06-03','2026-11-30',180,39264.16,'2026-11-01',39264.16,'Local Purchase'),
  ('WCTUKA077255','Blue Tiger Ltd','BlueTigeTP030626','GBP',12000,'GBP',12000,'Disbursed','-','HSBC TradePay','2026-06-03','2026-11-25',175,12000,'2026-11-01',12000,'Opex'),
  ('WCTUKA077182','Supreme Freight Limited','SUPREMETP020626','GBP',110027.24,'GBP',110027.24,'Disbursed','-','HSBC TradePay','2026-06-02','2026-11-18',169,110027.24,'2026-11-01',110027.24,'Opex'),
  ('WCTUKA077148','Korea Foods Limited','KoreaTP0206026','GBP',8404.2,'GBP',8404.2,'Disbursed','-','HSBC TradePay','2026-06-02','2026-11-11',162,8404.2,'2026-11-01',8404.2,'Local Purchase'),
  ('WCTUKA076904','Epoch-Making Toys Ltd','EPOCHTP010626','GBP',16983.43,'GBP',16983.43,'Disbursed','-','HSBC TradePay','2026-06-01','2026-11-11',163,16983.43,'2026-11-01',16983.43,'Local Purchase'),
  ('WCTUKA076902','A B Gee of Ripley Ltd','ABGEETP010626','GBP',12938.64,'GBP',12938.64,'Disbursed','-','HSBC TradePay','2026-06-01','2026-11-18',170,12938.64,'2026-11-01',12938.64,'Local Purchase'),
  ('WCTUKA076894','B Batch Limited','BBATCHTP010626','GBP',32343.37,'GBP',32343.37,'Disbursed','-','HSBC TradePay','2026-06-01','2026-11-11',163,32343.37,'2026-11-01',32343.37,'Capex'),
  ('WCTUKA076885','Unisnacks Europe Ltd','UnisnackTP010626','GBP',37170.15,'GBP',37170.15,'Disbursed','-','HSBC TradePay','2026-06-01','2026-11-25',177,37170.15,'2026-11-01',37170.15,'Local Purchase'),
  ('WCTUKA076587','GXO LOGISTICS UK LIMITED','GXOTP290526','GBP',66085.37,'GBP',66085.37,'Disbursed','-','HSBC TradePay','2026-05-29','2026-11-11',166,66085.37,'2026-11-01',66085.37,'Opex'),
  ('WCTUKA076593','Esdevium Games Limited','ESDEVIUMTP290526','GBP',114177.12,'GBP',114177.12,'Disbursed','-','HSBC TradePay','2026-05-29','2026-11-18',173,114177.12,'2026-11-01',114177.12,'Local Purchase'),
  ('LAIUK1076002','Miniso','LC87 21.04.26 1/3','USD',228802.02,'USD',228802.02,'Disbursed','-','Post-shipment buyer loan','2026-05-27','2026-11-23',180,228802.02,'2026-11-01',170747.77611940296,'Miniso LC''s'),
  ('WCTUKA075867','Digi East Wholesale LTD','DigiEastTP260526','GBP',6785.76,'GBP',6785.76,'Disbursed','-','HSBC TradePay','2026-05-26','2026-10-28',155,6785.76,'2026-10-01',6785.76,'Local Purchase'),
  ('LAIUK1075524','Miniso','LC87 21.04.26 3/3','USD',225484.18,'USD',225484.18,'Disbursed','-','Post-shipment buyer loan','2026-05-22','2026-11-18',180,225484.18,'2026-11-01',168271.77611940296,'Miniso LC''s'),
  ('WCTUKA075565','GXO LOGISTICS UK LIMITED','GXOTP220526','GBP',220912.17,'GBP',220912.17,'Disbursed','-','HSBC TradePay','2026-05-22','2026-10-28',159,220912.17,'2026-10-01',220912.17,'Opex'),
  ('LAIUK1075531','Miniso','LC87 21.04.26 2/3','USD',230136.63,'USD',230136.63,'Disbursed','-','Post-shipment buyer loan','2026-05-22','2026-11-18',180,230136.63,'2026-11-01',171743.75373134328,'Miniso LC''s'),
  ('WCTUKA075422','Design Signage Solution','DesignTP210526','GBP',13614.05,'GBP',13614.05,'Disbursed','-','HSBC TradePay','2026-05-21','2026-11-17',180,13614.05,'2026-11-01',13614.05,'Capex'),
  ('WCTUKA075056','ASCO Foods Limited','ASCOTP190526','GBP',21054.08,'GBP',21054.08,'Disbursed','-','HSBC TradePay','2026-05-19','2026-11-06',171,21054.08,'2026-11-01',21054.08,'Local Purchase'),
  ('WCTUKA074663','World of Sweets','WorldSweTO150526','GBP',9381,'GBP',9381,'Disbursed','-','HSBC TradePay','2026-05-18','2026-11-11',177,9381,'2026-11-01',9381,'Local Purchase'),
  ('WCTUKA074646','Mighty Jaxx','MightyJaTP150526','USD',12614.4,'USD',12614.4,'Disbursed','-','HSBC TradePay','2026-05-15','2026-11-10',179,12614.4,'2026-11-01',9413.731343283582,'Local Purchase'),
  ('WCTUKA074617','Ashbridge Interiors Ltd','ASHBRIDGTP150526','GBP',75786.6,'GBP',75786.6,'Disbursed','-','HSBC TradePay','2026-05-15','2026-10-28',166,75786.6,'2026-10-01',75786.6,'Local Purchase'),
  ('WCTUKA073700','A B Gee of Ripley Ltd','ABGEETP110526','GBP',14929.2,'GBP',14929.2,'Disbursed','-','HSBC TradePay','2026-05-11','2026-10-30',172,14929.2,'2026-10-01',14929.2,'Local Purchase'),
  ('WCTUKA073699','DKB Toys and Distribution Ltd','DKBTP110526','GBP',8064,'GBP',8064,'Disbursed','-','HSBC TradePay','2026-05-11','2026-10-28',170,8064,'2026-10-01',8064,'Local Purchase'),
  ('WCTUKA073698','Unisnacks Europe Ltd','UNISNACKTP110526','GBP',8640,'GBP',8640,'Disbursed','-','HSBC TradePay','2026-05-11','2026-10-27',169,8640,'2026-10-01',8640,'Local Purchase'),
  ('WCTUKA073696','Design Signage Solution','DESIGNSITP110526','GBP',10724.4,'GBP',10724.4,'Disbursed','-','HSBC TradePay','2026-05-11','2026-10-28',170,10724.4,'2026-10-01',10724.4,'Capex'),
  ('WCTUKA073261','Supreme Freight Limited','SupremeTP070526','GBP',15652.83,'GBP',15652.83,'Disbursed','-','HSBC TradePay','2026-05-07','2026-10-21',167,15652.83,'2026-10-01',15652.83,'Opex'),
  ('WCTUKA072488','Miniso Development Hong Kong','MinisoTP010526','USD',63200.68,'USD',63200.68,'Disbursed','-','HSBC TradePay','2026-05-01','2026-10-28',180,63200.68,'2026-10-01',47164.68656716418,'Miniso Facility'),
  ('WCTUKA072478','Esdevium Games Limited','EsdeviumTP010526','GBP',52677.6,'GBP',52677.6,'Disbursed','-','HSBC TradePay','2026-05-01','2026-10-14',166,52677.6,'2026-10-01',52677.6,'Local Purchase'),
  ('WCTUKA071714','GXO LOGISTICS UK LIMITED','GXOTP2804262','GBP',91027.15,'GBP',91027.15,'Disbursed','-','HSBC TradePay','2026-04-28','2026-09-30',155,91027.15,'2026-09-01',91027.15,'Opex'),
  ('WCTUKA071706','GXO LOGISTICS UK LIMITED','GXOTP280426','GBP',187214.46,'GBP',187214.46,'Disbursed','-','HSBC TradePay','2026-04-28','2026-09-30',155,187214.46,'2026-09-01',187214.46,'Opex'),
  ('WCTUKA071442','Miniso Development Hong Kong','MinisoTP2404262','USD',266336.44,'USD',266336.44,'Disbursed','-','HSBC TradePay','2026-04-24','2026-10-21',180,266336.44,'2026-10-01',198758.53731343284,'Miniso Facility'),
  ('WCTUKA071440','Miniso Development Hong Kong','MinisoTP240426','USD',224904.04,'USD',224904.04,'Disbursed','-','HSBC TradePay','2026-04-24','2026-10-21',180,224904.04,'2026-10-01',167838.83582089553,'Miniso Facility'),
  ('WCTUKA071018','Miniso Development Hong Kong','MinisoTP220426','USD',189601.7,'USD',189601.7,'Disbursed','-','HSBC TradePay','2026-04-24','2026-10-20',179,189601.7,'2026-10-01',141493.80597014926,'Miniso Facility'),
  ('WCTUKA071042','Miniso Development Hong Kong','MinisoTP2204264','USD',91941.47,'USD',91941.47,'Disbursed','-','HSBC TradePay','2026-04-23','2026-10-19',179,91941.47,'2026-10-01',68613.03731343283,'Miniso Facility'),
  ('WCTUKA071041','Unisnacks Europe Ltd','UnisnackTP220426','GBP',12735.9,'GBP',12735.9,'Disbursed','-','HSBC TradePay','2026-04-23','2026-09-16',146,12735.9,'2026-09-01',12735.9,'Local Purchase'),
  ('WCTUKA071020','Miniso Development Hong Kong','MinisoTP2204263','USD',192136.32,'USD',192136.32,'Disbursed','-','HSBC TradePay','2026-04-23','2026-10-19',179,192136.32,'2026-10-01',143385.31343283583,'Miniso Facility'),
  ('WCTUKA071011','Miniso Development Hong Kong','MinisoTP2204262','USD',131746.16,'USD',131746.16,'Disbursed','-','HSBC TradePay','2026-04-23','2026-10-19',179,131746.16,'2026-10-01',98318.02985074627,'Miniso Facility'),
  ('WCTUKA071009','Blue Tiger Ltd','BlueTigeTP220426','GBP',57600,'GBP',57600,'Disbursed','-','HSBC TradePay','2026-04-23','2026-09-16',146,57600,'2026-09-01',57600,'Opex'),
  ('WCTUKA070077','Miniso Development Hong Kong','MINISOTP160426','USD',167987.28,'USD',167987.28,'Disbursed','-','HSBC TradePay','2026-04-16','2026-10-13',180,167987.28,'2026-10-01',125363.64179104476,'Miniso Facility'),
  ('WCTUKA070079','Miniso Development Hong Kong','MINISOTP1604262','USD',148960.06,'USD',148960.06,'Disbursed','-','HSBC TradePay','2026-04-16','2026-10-13',180,148960.06,'2026-10-01',111164.22388059701,'Miniso Facility'),
  ('WCTUKA070082','Miniso Development Hong Kong','MINISOTP1604263','USD',54551.36,'USD',54551.36,'Disbursed','-','HSBC TradePay','2026-04-16','2026-10-13',180,54551.36,'2026-10-01',40709.97014925373,'Miniso Facility'),
  ('LAIUK1069585','Miniso','LC86 12.03.26 1/2','USD',291660.38,'USD',291660.38,'Disbursed','-','Post-shipment buyer loan','2026-04-14','2026-10-13',182,291660.38,'2026-10-01',217657,'Miniso LC''s'),
  ('LAIUK1069595','Miniso','LC86 12.03.26 2/2','USD',300274.54,'USD',300274.54,'Disbursed','-','Post-shipment buyer loan','2026-04-14','2026-10-13',182,300274.54,'2026-10-01',224085.47761194027,'Miniso LC''s'),
  ('WCTUKA069624','Esdevium Games Limited','EsdeviumTP140426','GBP',117398.28,'GBP',117398.28,'Disbursed','-','HSBC TradePay','2026-04-14','2026-10-07',176,117398.28,'2026-10-01',117398.28,'Local Purchase'),
  ('WCTUKA069158','Mighty Jaxx','MIGHTYJATP100426','GBP',10800,'GBP',10800,'Disbursed','-','HSBC TradePay','2026-04-10','2026-09-23',166,10800,'2026-09-01',10800,'Local Purchase'),
  ('WCTUKA069165','Rand Diffusion','RANDTP100426','GBP',11450.8,'GBP',11450.8,'Disbursed','-','HSBC TradePay','2026-04-10','2026-09-23',166,11450.8,'2026-09-01',11450.8,'Local Purchase'),
  ('WCTUKA069160','Bandai UK Limited','BANDAITP100426','GBP',10800,'GBP',10800,'Disbursed','-','HSBC TradePay','2026-04-10','2026-09-23',166,10800,'2026-09-01',10800,'Local Purchase'),
  ('WCTUKA069149','Epoch-Making Toys Ltd','EPOCHTP100426','GBP',27095.04,'GBP',27095.04,'Disbursed','-','HSBC TradePay','2026-04-10','2026-09-23',166,27095.04,'2026-09-01',27095.04,'Local Purchase'),
  ('WCTUKA069141','B Batch Limited','BATCHTP100426','GBP',89218.81,'GBP',89218.81,'Disbursed','-','HSBC TradePay','2026-04-10','2026-09-28',171,89218.81,'2026-09-01',89218.81,'Capex'),
  ('WCTUKA069142','Waddington Ledger Limited','WaddingtTP100426','GBP',11748,'GBP',11748,'Disbursed','-','HSBC TradePay','2026-04-10','2026-09-28',171,11748,'2026-09-01',11748,'Local Purchase'),
  ('WCTUKA068769','Supreme Freight Limited','SUPREMETP080426','GBP',38150.28,'GBP',38150.28,'Disbursed','-','HSBC TradePay','2026-04-08','2026-09-02',147,38150.28,'2026-09-01',38150.28,'Opex'),
  ('WCTUKA068522','STAR ORIENTAL TRADING LTD','StarOrieTP070426','GBP',24800.12,'GBP',24800.12,'Disbursed','-','HSBC TradePay','2026-04-07','2026-08-19',134,24800.12,'2026-08-01',24800.12,'Local Purchase'),
  ('WCTUKA068515','Design Signage Solution','DesignSiTP070426','GBP',39360,'GBP',39360,'Disbursed','-','HSBC TradePay','2026-04-07','2026-09-02',148,39360,'2026-09-01',39360,'Capex'),
  ('WCTUKA068495','Miniso Development Hong Kong','MinisoHQTP070426','GBP',81600,'GBP',81600,'Disbursed','-','HSBC TradePay','2026-04-07','2026-10-02',178,81600,'2026-10-01',81600,'Miniso Facility'),
  ('WCTUKA068506','Esdevium Games Limited','EsdeviumTP070426','GBP',40348.8,'GBP',40348.8,'Disbursed','-','HSBC TradePay','2026-04-07','2026-09-09',155,40348.8,'2026-09-01',40348.8,'Local Purchase'),
  ('LAIUK1067421','Miniso','LC85 02.03.26','USD',539951.42,'USD',539951.42,'Disbursed','-','Post-shipment buyer loan','2026-04-02','2026-09-29',180,539951.42,'2026-09-01',402948.82089552237,'Miniso LC''s'),
  ('WCTUKA066836','B Batch Limited','BatchTP250326','GBP',120046.13,'GBP',120046.13,'Disbursed','-','HSBC TradePay','2026-04-01','2026-09-04',156,120046.13,'2026-09-01',120046.13,'Capex'),
  ('WCTUKA067669','Europa Worldwide Group','EuropaTP310326','GBP',75616.07,'GBP',75616.07,'Disbursed','-','HSBC TradePay','2026-04-01','2026-09-03',155,75616.07,'2026-09-01',75616.07,'Opex'),
  ('WCTUKA066508','GXO LOGISTICS UK LIMITED','GXOTP230326','GBP',194126.15,'GBP',194126.15,'Disbursed','-','HSBC TradePay','2026-03-25','2026-09-01',160,194126.15,'2026-09-01',194126.15,'Opex'),
  ('WCTUKA065104','Blue Tiger Ltd','BlueTigTP120326','GBP',27120,'GBP',27120,'Disbursed','-','HSBC TradePay','2026-03-12','2026-09-01',173,27120,'2026-09-01',27120,'Opex'),
  ('WCTUKA065100','Rand Diffusion','RANDTP120326','GBP',5838,'GBP',5838,'Disbursed','-','HSBC TradePay','2026-03-12','2026-08-26',167,5838,'2026-08-01',5838,'Local Purchase'),
  ('WCTUKA065099','Pyramid International','PyramidTP120326','GBP',6768,'GBP',6768,'Disbursed','-','HSBC TradePay','2026-03-12','2026-08-26',167,6768,'2026-08-01',6768,'Opex'),
  ('WCTUKA065096','A B Gee of Ripley Ltd','ABGEETP120326','GBP',14929,'GBP',14929,'Disbursed','-','HSBC TradePay','2026-03-12','2026-08-26',167,14929,'2026-08-01',14929,'Local Purchase'),
  ('WCTUKA065094','Waddington Ledger Limited','WaddingTP120326','GBP',19992,'GBP',19992,'Disbursed','-','HSBC TradePay','2026-03-12','2026-08-19',160,19992,'2026-08-01',19992,'Local Purchase'),
  ('WCTUKA064970','Europa Worldwide Group','EuropaTP110326','GBP',78164.61,'GBP',78164.61,'Disbursed','-','HSBC TradePay','2026-03-11','2026-08-12',154,78164.61,'2026-08-01',78164.61,'Opex'),
  ('WCTUKA064547','Esdevium Games Limited','ESDEVTP090326-03','GBP',30931.2,'GBP',30931.2,'Disbursed','-','HSBC TradePay','2026-03-10','2026-08-20',163,30931.2,'2026-08-01',30931.2,'Local Purchase'),
  ('WCTUKA064544','Esdevium Games Limited','EsdevTP090326-02','GBP',31024.8,'GBP',31024.8,'Disbursed','-','HSBC TradePay','2026-03-10','2026-08-20',163,31024.8,'2026-08-01',31024.8,'Local Purchase'),
  ('WCTUKA064539','Esdevium Games Limited','EsdevTP090326-01','GBP',16668,'GBP',16668,'Disbursed','-','HSBC TradePay','2026-03-10','2026-08-20',163,16668,'2026-08-01',16668,'Local Purchase'),
  ('WCTUKA063461','KOHLICO Brands UK Ltd','KOHLICOTP020326','GBP',8996.4,'GBP',8996.4,'Disbursed','-','HSBC TradePay','2026-03-02','2026-08-05',156,8996.4,'2026-08-01',8996.4,'Local Purchase'),
  ('WCTUKA063436','Digi East Wholesale LTD','DigiEastTP020326','GBP',22141.64,'GBP',22141.64,'Disbursed','-','HSBC TradePay','2026-03-02','2026-08-12',163,22141.64,'2026-08-01',22141.64,'Local Purchase'),
  ('WCTUKA063434','Miniso Trading Sp. z o.o Poland','MinisoPoTP020326','EUR',33926.91,'EUR',33926.91,'Disbursed','-','HSBC TradePay','2026-03-02','2026-08-28',179,33926.91,'2026-08-01',33926.91,'Miniso Poland'),
  ('WCTUKA062815','Europa Worldwide Group','EuropaTP250226','GBP',54422.62,'GBP',54422.62,'Disbursed','-','HSBC TradePay','2026-02-27','2026-07-31',154,54422.62,'2026-07-01',54422.62,'Opex'),
  ('WCTUKA063006','Europa Worldwide Group','EuropaTP260226','GBP',46277.2,'GBP',46277.2,'Disbursed','-','HSBC TradePay','2026-02-27','2026-08-05',159,46277.2,'2026-08-01',46277.2,'Opex'),
  ('WCTUKA062610','Blue Tiger Ltd','BlueTigeTP240226','GBP',44160,'GBP',44160,'Disbursed','-','HSBC TradePay','2026-02-24','2026-08-12',169,44160,'2026-08-01',44160,'Opex'),
  ('WCTUKA062611','Esdevium Games Limited','EsdeviumTP240226','GBP',80069.76,'GBP',80069.76,'Disbursed','-','HSBC TradePay','2026-02-24','2026-08-05',162,80069.76,'2026-08-01',80069.76,'Local Purchase'),
  ('WCTUKA062162','7th Heaven, Montagne Jeunesse Ltd','7THHEAVETP190226','GBP',17667.07,'GBP',17667.07,'Disbursed','-','HSBC TradePay','2026-02-20','2026-08-03',164,17667.07,'2026-08-01',17667.07,'Local Purchase'),
  ('WCTUKA062155','Europa Worldwide Group','EuropaTP190226','GBP',109897.87,'GBP',109897.87,'Disbursed','-','HSBC TradePay','2026-02-19','2026-07-31',162,109897.87,'2026-07-01',109897.87,'Opex'),
  ('WCTUKA061812','Pinnaca Solutions Limited','PinnacaTP170226','GBP',57024.43,'GBP',57024.43,'Disbursed','-','HSBC TradePay','2026-02-17','2026-07-31',164,57024.43,'2026-07-01',57024.43,'Capex'),
  ('WCTUKA061825','Rand Diffusion','RANDTP170226','GBP',19429,'GBP',19429,'Disbursed','-','HSBC TradePay','2026-02-17','2026-08-04',168,19429,'2026-08-01',19429,'Local Purchase'),
  ('WCTUKA061808','Design Signage Solution','DESIGNSITP170226','GBP',32012.29,'GBP',32012.29,'Disbursed','-','HSBC TradePay','2026-02-17','2026-07-31',164,32012.29,'2026-07-01',32012.29,'Capex'),
  ('WCTUKA061326','Ashbridge Interiors Ltd','AshbrigdTP120226','GBP',28142.63,'GBP',28142.63,'Disbursed','-','HSBC TradePay','2026-02-12','2026-07-31',169,28142.63,'2026-07-01',28142.63,'Local Purchase'),
  ('LAIUK1058255','Miniso','LC84 16.12.25','USD',69237.84,'USD',69237.84,'Disbursed','-','Post-shipment buyer loan','2026-01-22','2026-08-20',210,69237.84,'2026-08-01',51670.029850746265,'Miniso LC''s'),
  ('LAIUK1057450','Miniso','LC84 16.12.25','USD',405004.84,'USD',405004.84,'Disbursed','-','Post-shipment buyer loan','2026-01-19','2026-08-19',212,405004.84,'2026-08-01',302242.41791044775,'Miniso LC''s'),
  ('LAIUK1055597','Miniso','LC82 05.12.25','USD',480782,'USD',480782,'Disbursed','-','Post-shipment buyer loan','2026-01-06','2026-08-05',211,480782,'2026-08-01',358792.53731343284,'Miniso LC''s')
ON CONFLICT (reference) DO NOTHING;

COMMIT;

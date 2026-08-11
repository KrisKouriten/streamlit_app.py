-- Migration 097 — Month-end close checklist (working-day sequenced)
-- Seeds the finance team's month-end close checklist into workflow.task_template
-- as active MONTHLY templates, unassigned ("to be assigned later"), sequenced by
-- working day (WD). due_day approximates the working day for monthly generation
-- (WD-2 pre-close and WD1 both fall on day 1); the true working day is stated in
-- each description. This is the one WD-sequenced checklist — per-entity
-- applicability across the store companies + Head Office is a later layer.
--
-- Entity naming: the UK operating (import) company is referred to as Miniso UK;
-- the separate stores company is described functionally so the intercompany
-- distinction is preserved without legal-entity names.
--
-- Down (manual):
--   DELETE FROM workflow.task_template
--   WHERE frequency='MONTHLY' AND created_by='migration:097';

INSERT INTO workflow.task_template
  (title, description, frequency, due_day, priority, est_minutes,
   requires_review, requires_evidence, is_active, created_by)
SELECT v.title, v.description, 'MONTHLY', v.due_day, v.priority, v.est_minutes,
       false, false, true, 'migration:097'
FROM (VALUES
  -- WD -2 (pre-close) → due_day 1
  ('Confirm close calendar, owners & deadlines circulated', 'Month-end close · WD-2 (pre-close). Circulate the close calendar, owners and deadlines.',            1, 'HIGH',   30),
  ('Cut-off communications issued to team and BDO',         'Month-end close · WD-2 (pre-close). Issue cut-off communications within the team and to BDO.',       1, 'MEDIUM', 20),
  ('Reconciliation & balance-sheet file rolled forward',    'Month-end close · WD-2 (pre-close). Roll the reconciliation and balance-sheet file forward.',        1, 'MEDIUM', 20),
  ('Prior-month review points & audit actions cleared',     'Month-end close · WD-2 (pre-close). Clear prior-month review points and audit actions.',             1, 'MEDIUM', 30),
  -- WD 1 → due_day 1
  ('Purchase invoice posting cut off',                      'Month-end close · WD1. Apply the purchase-invoice posting cut-off.',                                 1, 'HIGH',   30),
  ('Bank statements imported',                              'Month-end close · WD1. Import bank statements (HSBC current account and HSBC Trade Pay).',           1, 'HIGH',   30),
  ('All bank accounts reconciled',                          'Month-end close · WD1. Reconcile all bank accounts, including the HSBC current account.',            1, 'HIGH',   60),
  ('Adyen to Power BI reconciliation (store sales)',        'Month-end close · WD1. Reconcile Adyen settlements to the Power BI store-sales figures.',            1, 'MEDIUM', 45),
  ('Cash & FX revaluation',                                 'Month-end close · WD1. Revalue cash and FX balances.',                                               1, 'MEDIUM', 45),
  ('Turnover confirmation certificates',                    'Month-end close · WD1. Issue turnover confirmation certificates (quarterly).',                       1, 'MEDIUM', 30),
  -- WD 2 → due_day 2
  ('Establishment costs & utilities review',                'Month-end close · WD2. Review establishment costs and utilities.',                                   2, 'MEDIUM', 30),
  ('Review PO trackers (weekly and monthly)',               'Month-end close · WD2. Derive accruals from purchase orders not yet closed.',                        2, 'HIGH',   45),
  ('Post e-commerce sales & COS journal',                   'Month-end close · WD2. Post the e-commerce sales and cost-of-sales journal.',                        2, 'MEDIUM', 30),
  ('E-commerce inventory journal',                          'Month-end close · WD2. Post the e-commerce inventory journal from the logistics stock movement.',    2, 'MEDIUM', 30),
  ('Weekly stock invoice posting for franchisees',          'Month-end close · WD2. Post the weekly franchisee stock invoices.',                                  2, 'MEDIUM', 30),
  ('Monthly stock invoicing to stores',                     'Month-end close · WD2. Monthly stock invoicing from the import company (Miniso UK) to stores.',      2, 'MEDIUM', 45),
  ('COS monthly invoices to stores',                        'Month-end close · WD2. Monthly cost-of-sales invoices from the import company (Miniso UK) to stores.',2, 'MEDIUM', 45),
  ('Weekly consignment invoices to franchisees',            'Month-end close · WD2. Raise the weekly consignment invoices to franchisees.',                       2, 'MEDIUM', 30),
  ('Monthly consignment invoices to stores',                'Month-end close · WD2. Raise the monthly consignment invoices to stores.',                           2, 'MEDIUM', 30),
  ('Franchisee invoicing raised and sent (fee %s)',         'Month-end close · WD2. Management fee and advertisement levy issued to franchisees on turnover.',    2, 'HIGH',   45),
  ('GXO cost recharges to franchisees',                     'Month-end close · WD2. Recharge GXO costs to franchisees.',                                          2, 'MEDIUM', 30),
  ('Disbursement (700) recharges to stores — import company','Month-end close · WD2. Recharge disbursement account (700) to stores from the import company (Miniso UK), including GXO costs.', 2, 'MEDIUM', 30),
  ('Disbursement (700) recharges to stores — stores company','Month-end close · WD2. Recharge disbursement account (700) to stores from the stores company.',     2, 'MEDIUM', 30),
  ('Send AR to franchisees',                                'Month-end close · WD2. Send accounts-receivable statements to franchisees (weekly, Tuesdays).',      2, 'MEDIUM', 20),
  ('Payroll journal posted',                                'Month-end close · WD2. Post the payroll journal.',                                                  2, 'HIGH',   30),
  ('Holiday pay accrual',                                   'Month-end close · WD2. Post the holiday-pay accrual.',                                               2, 'MEDIUM', 20),
  ('AP ageing reviewed',                                    'Month-end close · WD2. Review AP ageing to help create accruals.',                                   2, 'MEDIUM', 30),
  -- WD 3 → due_day 3
  ('Intercompany matched & eliminated',                     'Month-end close · WD3. Match and eliminate intercompany using the three IC accounts (700, 898, 899).',3, 'HIGH',   60),
  ('Create accruals to send to BDO',                        'Month-end close · WD3. Basis key: 1 Actual invoice, 2 Activity-based, 3 Forecast.',                  3, 'MEDIUM', 45),
  ('Accruals posted',                                       'Month-end close · WD3. Post accruals, including merchant fees at 1% of sales.',                      3, 'HIGH',   30),
  ('Create prepayment schedule to send to BDO',             'Month-end close · WD3. Prepare the prepayment schedule for BDO to post.',                            3, 'MEDIUM', 30),
  ('Prepayments amortised',                                 'Month-end close · WD3. Amortise prepayments.',                                                      3, 'MEDIUM', 20),
  ('Fixed asset additions added to the register',           'Month-end close · WD3. Check for fixed-asset additions; for stores create FARs for the tills.',      3, 'MEDIUM', 30),
  ('Depreciation run',                                      'Month-end close · WD3. Run depreciation.',                                                          3, 'HIGH',   30),
  -- WD 4 → due_day 4
  ('Trial balance review',                                  'Month-end close · WD4. Review the trial balance.',                                                  4, 'HIGH',   45),
  ('Margin & KPI review',                                   'Month-end close · WD4. Review margin and KPIs.',                                                    4, 'MEDIUM', 45),
  ('P&L review',                                            'Month-end close · WD4. Confirm accruals/prepayments have the intended impact.',                      4, 'HIGH',   45),
  ('Flux / variance review',                                'Month-end close · WD4. Review flux/variance and add commentary where applicable.',                   4, 'MEDIUM', 45),
  -- WD 5 → due_day 5
  ('VAT / tax provision',                                   'Month-end close · WD5. Post the VAT / tax provision.',                                               5, 'HIGH',   45),
  ('Management pack issued',                                'Month-end close · WD5. Issue the management pack.',                                                 5, 'HIGH',   60),
  ('CFO sign-off',                                          'Month-end close · WD5. Obtain CFO sign-off.',                                                       5, 'CRITICAL',20)
) AS v(title, description, due_day, priority, est_minutes)
WHERE NOT EXISTS (
  SELECT 1 FROM workflow.task_template t
  WHERE t.title = v.title AND t.frequency = 'MONTHLY'
);

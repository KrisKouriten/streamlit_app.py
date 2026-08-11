-- Migration 095 — Weekly recurring finance tasks (Perform · Task Library)
-- Seeds the finance team's standing weekly checklist into workflow.task_template
-- as active WEEKLY templates on the correct weekday (0=Mon … 4=Fri). Templates
-- carry no default assignee ("to be assigned later"): the weekly generator
-- creates dated, unassigned instances that a manager allocates on the Team
-- Schedule. Routine operational tasks, so requires_review / requires_evidence
-- are false. Idempotent — each (title, weekday) is inserted only if absent.
--
-- Down (manual):
--   DELETE FROM workflow.task_template
--   WHERE frequency='WEEKLY' AND created_by='migration:095';

INSERT INTO workflow.task_template
  (title, description, frequency, due_weekday, priority, est_minutes,
   requires_review, requires_evidence, is_active, created_by)
SELECT v.title, v.description, 'WEEKLY', v.due_weekday, v.priority, v.est_minutes,
       false, false, true, 'migration:095'
FROM (VALUES
  -- Monday (0)
  ('Account Inbox',                          'Clear and action the finance account inbox.',                 0, 'MEDIUM', 30),
  ('Franchise Inbox',                        'Clear and action the franchise inbox.',                       0, 'MEDIUM', 30),
  ('Bank Reconciliations',                   'Reconcile the bank accounts for the week.',                   0, 'HIGH',   60),
  ('Store Cash Reconciliations',             'Reconcile store cash takings for the week.',                  0, 'MEDIUM', 45),
  ('Intercompany Reconciliations',           'Match and reconcile intercompany balances.',                  0, 'HIGH',   60),
  ('Sales & KPI Analysis',                   'Review the weekly store sales and KPI position.',             0, 'MEDIUM', 45),
  ('Cashflow Reconciliations',               'Reconcile the weekly cashflow position.',                     0, 'MEDIUM', 45),
  ('Facility Reconciliations',               'Reconcile the HSBC trade facility drawings.',                 0, 'HIGH',   45),
  -- Tuesday (1)
  ('Franchisee AR emails',                   'Send accounts-receivable statements to franchisees.',         1, 'MEDIUM', 30),
  ('Weekly Franchisee Consignment invoicing','Raise the weekly franchisee consignment invoices.',           1, 'HIGH',   60),
  ('Weekly Franchisee Stock invoicing',      'Raise the weekly franchisee stock invoices.',                 1, 'HIGH',   60),
  ('Supplier Payment Run preparation',       'Prepare the supplier payment run for approval.',              1, 'HIGH',   60),
  -- Wednesday (2)
  ('Account Inbox',                          'Clear and action the finance account inbox.',                 2, 'MEDIUM', 30),
  ('Franchise Inbox',                        'Clear and action the franchise inbox.',                       2, 'MEDIUM', 30),
  ('BDO purchase invoices postings',         'Post BDO purchase invoices.',                                 2, 'MEDIUM', 60),
  ('Intercompany Reconciliations',           'Match and reconcile intercompany balances.',                  2, 'HIGH',   60),
  -- Thursday (3)
  ('AR review',                              'Review accounts-receivable ageing and follow-ups.',           3, 'MEDIUM', 45),
  ('Bank Reconciliations',                   'Reconcile the bank accounts.',                                3, 'HIGH',   45),
  ('Facility Reconciliations',               'Reconcile the HSBC trade facility drawings.',                 3, 'HIGH',   45),
  ('Inventory Analysis',                     'Review the inventory position and movements.',                3, 'MEDIUM', 45),
  ('Allocation Analysis',                    'Review stock allocation across stores.',                      3, 'MEDIUM', 45),
  -- Friday (4)
  ('BDO purchase invoices postings',         'Post BDO purchase invoices.',                                 4, 'MEDIUM', 60),
  ('Expenses Payment Run',                   'Process the weekly expenses payment run.',                    4, 'HIGH',   60),
  ('Supplier Payment Run',                   'Process the weekly supplier payment run.',                    4, 'HIGH',   60),
  ('Week-end close checklist',               'Complete the week-end close checklist.',                      4, 'HIGH',   60),
  ('Bank Reconciliations',                   'Reconcile the bank accounts.',                                4, 'HIGH',   45),
  ('Issue Inventory Invoices',               'Issue the weekly inventory invoices.',                        4, 'HIGH',   60)
) AS v(title, description, due_weekday, priority, est_minutes)
WHERE NOT EXISTS (
  SELECT 1 FROM workflow.task_template t
  WHERE t.title = v.title AND t.frequency = 'WEEKLY' AND t.due_weekday = v.due_weekday
);

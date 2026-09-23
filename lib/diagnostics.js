/*
 * Data Quality — gathers the facts the checks in diagnostics-rules.js run over.
 *
 * Every read is independent and best-effort: a missing table returns null (which
 * the rules report as a FAIL naming the migration) rather than throwing, so one
 * gap can't blind the rest of the page. That is the whole point — this screen
 * has to work precisely when something is broken.
 */

import { query } from "./db";
import {
  schemaCheck, columnCheck, facilityCheck, fxCheck, budgetCheck, paymentMethodCheck,
  overallStatus, CRITICAL_TABLES, CRITICAL_COLUMNS,
} from "./diagnostics-rules.js";

// null = the table isn't there; [] = it's there and empty. The difference is the
// difference between "apply a migration" and "upload the data", so it matters.
async function rowsOrNull(sql, params = []) {
  try {
    const { rows } = await query(sql, params);
    return rows;
  } catch { return null; }
}

export async function getDiagnostics() {
  const [present, cols, facility, rates, budgets, payment] = await Promise.all([
    rowsOrNull(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'finance' AND table_name = ANY($1)`,
      [CRITICAL_TABLES.map((t) => t.table)]),
    // Column-level gaps. A missing table is loud; a missing column is silent,
    // because every reader degrades to the columns it can actually select.
    rowsOrNull(
      `SELECT table_name AS tbl, column_name AS col FROM information_schema.columns
        WHERE table_schema = 'finance' AND table_name = ANY($1) AND column_name = ANY($2)`,
      [[...new Set(CRITICAL_COLUMNS.map((c) => c.table))], [...new Set(CRITICAL_COLUMNS.map((c) => c.column))]]),
    rowsOrNull(
      `SELECT cost_driver, to_char(due_date,'YYYY-MM') AS due_date,
              to_char(payment_month,'YYYY-MM') AS payment_month,
              facility_payment_gbp, payment_amount, payment_currency
         FROM finance.bank_trade_facility`),
    rowsOrNull(`SELECT currency, rate_type, rate FROM finance.fx_rate ORDER BY currency, rate_type`),
    rowsOrNull(`SELECT source, ym FROM finance.procurement_budget`),
    rowsOrNull(
      `SELECT count(*)::int AS paid,
              count(payment_method)::int AS tagged
         FROM finance.procurement_purchase WHERE payment_status = 'PAID'`),
  ]);

  // The currencies actually in use — what the FX check measures against, so it
  // reports a missing rate only where something needs it.
  const needed = [
    ...new Set([
      ...(facility || []).map((r) => r.payment_currency),
      ...((await rowsOrNull(`SELECT DISTINCT currency FROM finance.procurement_purchase WHERE currency IS NOT NULL`)) || [])
        .map((r) => r.currency),
    ]),
  ].filter(Boolean);

  const ratedSpot = (rates || []).filter((r) => String(r.rate_type).toUpperCase() === "SPOT").map((r) => r.currency);

  const checks = [
    schemaCheck((present || []).map((r) => r.table_name)),
    columnCheck(cols && cols.map((r) => ({ table: r.tbl, column: r.col }))),
    facilityCheck(facility, ratedSpot),
    fxCheck(needed, rates),
    budgetCheck(budgets),
    paymentMethodCheck(payment?.[0] || { paid: 0, tagged: 0 }),
  ];
  return { checks, status: overallStatus(checks), checkedAt: new Date().toISOString() };
}

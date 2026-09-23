/*
 * Data Quality — gathers the facts the checks in diagnostics-rules.js run over.
 *
 * Every read is independent and best-effort: a missing table returns null (which
 * the rules report as a FAIL naming the migration) rather than throwing, so one
 * gap can't blind the rest of the page. That is the whole point — this screen
 * has to work precisely when something is broken.
 */

import { query, connectionTarget } from "./db";
import {
  connectionCheck, schemaCheck, columnCheck, facilityCheck, fxCheck, budgetCheck, paymentMethodCheck,
  overallStatus, CRITICAL_TABLES, CRITICAL_COLUMNS,
} from "./diagnostics-rules.js";
import { pendingRepairs, repairsToRun, isAdditive } from "./migration-repairs.js";

// null = the table isn't there; [] = it's there and empty. The difference is the
// difference between "apply a migration" and "upload the data", so it matters.
async function rowsOrNull(sql, params = []) {
  try {
    const { rows } = await query(sql, params);
    return rows;
  } catch { return null; }
}

export async function getDiagnostics() {
  const [server, present, cols, facility, rates, budgets, payment] = await Promise.all([
    // What the SERVER says it is, alongside what the connection string claims.
    // They should agree; if they ever don't, that is worth seeing.
    rowsOrNull(`SELECT current_database() AS db, current_user AS usr`),
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
    connectionCheck({
      ...connectionTarget(),
      server: server?.[0] ? `${server[0].db} as ${server[0].usr}` : null,
    }),
    schemaCheck((present || []).map((r) => r.table_name)),
    columnCheck(cols && cols.map((r) => ({ table: r.tbl, column: r.col }))),
    facilityCheck(facility, ratedSpot),
    fxCheck(needed, rates),
    budgetCheck(budgets),
    paymentMethodCheck(payment?.[0] || { paid: 0, tagged: 0 }),
  ];
  return {
    checks, status: overallStatus(checks), checkedAt: new Date().toISOString(),
    // What the page can offer to fix in place. Derived from the same catalogue
    // read the Columns check uses, so the button cannot disagree with the check
    // sitting above it.
    repairs: pendingRepairs(missingCriticalColumns(cols && cols.map((r) => ({ table: r.tbl, column: r.col })))),
  };
}

// The critical columns that are absent, as [{table, column}]. Null from the
// catalogue read means we could not look, which is not the same as nothing
// missing — offer no repairs rather than guess.
function missingCriticalColumns(present) {
  if (present == null) return [];
  const have = new Set(present.map((c) => `${c.table}.${c.column}`));
  return CRITICAL_COLUMNS.filter((c) => !have.has(`${c.table}.${c.column}`)).map((c) => ({ table: c.table, column: c.column }));
}

/*
 * Apply the repairs the caller asked for, against the database THIS PROCESS is
 * connected to. That is the whole point: a SQL editor can be pointed anywhere,
 * and has been, five times. `query` here is the same pool every reader uses.
 *
 * Callers must check the role before calling — this is a data-layer function and
 * does not know who is asking.
 *
 * Each statement is re-validated as additive immediately before it runs, and the
 * missing-column list is re-read from the catalogue first, so a stale page cannot
 * replay a repair that has already been applied. Failures are reported per
 * repair rather than thrown: one column that will not take should not hide
 * another that did.
 */
export async function applyRepairs(keys = []) {
  const cols = await rowsOrNull(
    `SELECT table_name AS tbl, column_name AS col FROM information_schema.columns
      WHERE table_schema = 'finance' AND table_name = ANY($1) AND column_name = ANY($2)`,
    [[...new Set(CRITICAL_COLUMNS.map((c) => c.table))], [...new Set(CRITICAL_COLUMNS.map((c) => c.column))]]);
  if (cols == null) return { ran: [], target: connectionTarget() };

  const missing = missingCriticalColumns(cols.map((r) => ({ table: r.tbl, column: r.col })));
  const ran = [];
  for (const r of repairsToRun(keys, missing)) {
    // Belt and braces. Nothing from the caller reaches the statement — only the
    // fixed list in migration-repairs.js does — but an edit to that list must
    // fail here rather than execute.
    if (!isAdditive(r.sql)) { ran.push({ ...r, ok: false, error: "refused: not an additive column add" }); continue; }
    try {
      await query(r.sql);
      ran.push({ ...r, ok: true });
    } catch (e) {
      ran.push({ ...r, ok: false, error: String(e?.message || e) });
    }
  }
  // The target is reported back so the confirmation names the database it
  // landed on. Host and database only — connectionTarget never returns a
  // credential.
  return { ran, target: connectionTarget() };
}

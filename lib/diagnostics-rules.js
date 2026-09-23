/*
 * Data Quality — pure rules (no imports from the DB layer, no side effects).
 *
 * Why this exists: the platform reads optional data best-effort, so a feature
 * whose table is missing, whose upload never landed, or whose values the app
 * doesn't recognise degrades to an empty column rather than an error. That is
 * the right behaviour — a missing feed should not take a page down — but it
 * means several very different faults all render as the same dash, and the only
 * way to tell them apart has been to query the database by hand.
 *
 * These checks turn each of those silent states into a named one, with the
 * remedy attached. Unit-tested in tests/diagnostics-rules.test.mjs.
 */

import { facilitySourceOf } from "./procurement-rules.js";

export const OK = "OK";
export const WARN = "WARN";
export const FAIL = "FAIL";

// The tables a feature cannot work without, and what breaks when one is absent.
// Each migration filename is the file that actually contains the CREATE TABLE —
// verified against db/migrations, not inferred from the table name. A check that
// names a migration that doesn't exist sends someone hunting, which is worse than
// naming none, so tests/diagnostics-rules.test.mjs pins them.
// Not the full schema — the point is to name the consequence, not to inventory
// the database. Each entry carries the migration that creates it, so a gap is
// actionable on sight.
export const CRITICAL_TABLES = [
  { table: "bank_trade_facility", migration: "077_treasury.sql", feature: "Trade-pay spend, Treasury facility register" },
  { table: "procurement_purchase", migration: "016_procurement.sql", feature: "Procurement requests and the close desk" },
  { table: "procurement_budget", migration: "016_procurement.sql", feature: "Procurement budgets and every variance" },
  { table: "fx_rate", migration: "085_fx_rates.sql", feature: "Currency conversion on purchases and drawings" },
  { table: "purchase_order", migration: "046_purchase_order.sql", feature: "P.O requests and P.O close" },
  { table: "dept_budget", migration: "049_dept_budget.sql", feature: "Departmental budgets" },
  // Added after a database turned up with neither, while Schema still read
  // "all critical tables present" — because neither was on the list. Miniso
  // settles by letter of credit, so without these the close desk shows a Miniso
  // request with no LCs and no DCs and looks merely empty.
  { table: "procurement_lc", migration: "083_procurement_multi_lc.sql", feature: "Letters of credit against a Miniso request" },
  { table: "procurement_dc", migration: "093_procurement_dc.sql", feature: "Documentary Credits, and the open balance each LC draws against" },
];

// Columns a feature needs, on a table that already exists. A missing TABLE is
// loud — the feature has no data at all. A missing COLUMN is quiet: the readers
// degrade to the columns they can select, so the screen still renders and simply
// stops showing something.
//
// This check exists because that happened. `approval_status` (082) was never
// applied to the live database. The close desk's reader asked for it, failed,
// and fell back — silently losing the FX figures too, because the fallback tiers
// were chained. Nothing on any screen said so. The table check passed, because
// the table was there.
export const CRITICAL_COLUMNS = [
  { table: "procurement_purchase", column: "pickup_date", migration: "076_procurement_pickup_delivery.sql", feature: "Miniso's 180-day clock — without it orders land in the wrong month" },
  { table: "procurement_purchase", column: "approval_status", migration: "082_procurement_approval.sql", feature: "Raise → head of department → Finance sign-off, and excluding cancelled orders" },
  { table: "procurement_purchase", column: "currency", migration: "085_fx_rates.sql", feature: "Foreign-currency orders and the FX figures on the close desk" },
  { table: "procurement_purchase", column: "report_rate_type", migration: "091_procurement_report_basis.sql", feature: "The FX reporting basis" },
  { table: "procurement_purchase", column: "payment_method", migration: "113_procurement_payment_method.sql", feature: "Cash vs trade pay on a paid invoice, which drives Cash spend" },
];

const check = (key, label, status, summary, remedy = null, detail = []) =>
  ({ key, label, status, summary, remedy, detail });

// ---- Schema ----
// `present` is the set of table names that actually exist in the finance schema.
export function schemaCheck(present = []) {
  const have = new Set(present);
  const missing = CRITICAL_TABLES.filter((t) => !have.has(t.table));
  if (!missing.length) {
    return check("schema", "Schema", OK, `All ${CRITICAL_TABLES.length} critical tables present.`);
  }
  return check("schema", "Schema", FAIL,
    `${missing.length} critical table${missing.length === 1 ? "" : "s"} missing — the feature${missing.length === 1 ? "" : "s"} below will read empty, silently.`,
    "Apply the migration named against each, then refresh.",
    missing.map((t) => ({ label: `finance.${t.table}`, value: t.migration, note: t.feature, tone: FAIL })));
}

// ---- Which database ----
// Not a pass/fail so much as an identity. It leads the page because two of the
// faults this page exists to catch turned out not to be faults at all: the
// migration had been applied, just to a different branch than the app reads.
// Knowing which database is answering makes that visible in one glance instead
// of a hunt through Vercel's environment variables.
export function connectionCheck({ envKey = null, host = null, database = null, server = null } = {}) {
  const detail = [
    { label: "Database", value: database || "unknown" },
    { label: "Host", value: host || "unknown", note: "match this against the branch in Neon" },
    { label: "From variable", value: envKey || "none found", note: envKey === "DATABASE_URL" ? null : "DATABASE_URL is checked first and wins — this is a fallback" },
  ];
  if (server) detail.push({ label: "Reported by the server", value: server });
  if (!host) {
    return check("connection", "Database", WARN, "Could not read the connection target.",
      "Check DATABASE_URL is set on the Vercel project.", detail);
  }
  return check("connection", "Database", OK,
    `Connected to ${database || "?"} at ${host}.`,
    "Apply migrations to THIS database. A SQL editor open on another branch will report success and change nothing here.",
    detail);
}

// ---- Columns ----
// `present` is [{table, column}] for the columns that actually exist. null means
// the catalogue couldn't be read at all.
export function columnCheck(present = []) {
  if (present == null) {
    return check("columns", "Columns", WARN, "Could not read the database catalogue, so column-level gaps can't be reported.");
  }
  const have = new Set(present.map((c) => `${c.table}.${c.column}`));
  const missing = CRITICAL_COLUMNS.filter((c) => !have.has(`${c.table}.${c.column}`));
  if (!missing.length) {
    return check("columns", "Columns", OK, `All ${CRITICAL_COLUMNS.length} columns these features depend on are present.`);
  }
  return check("columns", "Columns", FAIL,
    `${missing.length} column${missing.length === 1 ? "" : "s"} missing — the table${missing.length === 1 ? " is" : "s are"} there, so nothing errors; the feature${missing.length === 1 ? "" : "s"} below just stop working.`,
    "Apply the migration named against each, then refresh. No deploy is needed — the readers pick a new column up on the next read.",
    missing.map((c) => ({ label: `finance.${c.table}.${c.column}`, value: c.migration, note: c.feature, tone: FAIL })));
}

// ---- Trade facility ----
// rows: [{cost_driver, due_date, payment_month, facility_payment_gbp,
//         payment_amount, payment_currency}] — the whole register.
// ratedCurrencies: currencies that have a SPOT rate set.
export function facilityCheck(rows = null, ratedCurrencies = []) {
  if (rows == null) {
    return check("facility", "Trade facility", FAIL, "The facility table is missing.",
      "Apply migration 077_treasury.sql.");
  }
  if (!rows.length) {
    return check("facility", "Trade facility", WARN, "No drawings loaded, so Trade-pay spend is nil everywhere.",
      "Treasury → Facility → Upload HSBC extract.");
  }
  const rated = new Set(ratedCurrencies.map((c) => String(c).toUpperCase()));
  const unknownDrivers = new Map();
  let procurement = 0, noMonth = 0, unpriced = 0;
  const unpricedCcy = new Map();
  for (const r of rows) {
    const src = facilitySourceOf(r);
    if (!src) {
      const d = String(r.cost_driver || "(blank)").trim() || "(blank)";
      unknownDrivers.set(d, (unknownDrivers.get(d) || 0) + 1);
      continue;
    }
    procurement += 1;
    if (!r.due_date && !r.payment_month) noMonth += 1;
    const hasGbp = r.facility_payment_gbp != null && Number(r.facility_payment_gbp);
    if (hasGbp) continue;
    const ccy = String(r.payment_currency || "GBP").toUpperCase();
    const amt = Number(r.payment_amount);
    if (!Number.isFinite(amt) || !amt) { unpriced += 1; unpricedCcy.set("(no amount)", (unpricedCcy.get("(no amount)") || 0) + 1); continue; }
    if (ccy !== "GBP" && !rated.has(ccy)) { unpriced += 1; unpricedCcy.set(ccy, (unpricedCcy.get(ccy) || 0) + 1); }
  }

  const detail = [
    { label: "Drawings loaded", value: String(rows.length) },
    { label: "Counted as procurement", value: String(procurement), tone: procurement ? OK : WARN },
  ];
  for (const [d, n] of unknownDrivers) {
    detail.push({ label: `Driver not recognised: ${d}`, value: `${n} drawing${n === 1 ? "" : "s"}`, note: "ignored by Trade-pay spend", tone: WARN });
  }
  if (noMonth) detail.push({ label: "No due date or payment month", value: String(noMonth), note: "cannot be placed in a month", tone: WARN });
  for (const [c, n] of unpricedCcy) {
    detail.push({ label: `Unpriced (${c})`, value: String(n), note: c === "(no amount)" ? "no GBP figure and no payment amount" : `no SPOT rate for ${c}`, tone: WARN });
  }

  if (!procurement) {
    return check("facility", "Trade facility", FAIL,
      `${rows.length} drawings loaded but none recognised as procurement, so Trade-pay spend is nil.`,
      "Check the cost driver wording — it must contain “Miniso LC”, “Miniso Facility” or “Local Purchase”.", detail);
  }
  if (unpriced || noMonth || unknownDrivers.size) {
    return check("facility", "Trade facility", WARN,
      `${procurement} procurement drawing${procurement === 1 ? "" : "s"} counted; ${unpriced + noMonth} not contributing to Trade-pay spend.`,
      unpriced ? "Set the missing SPOT rate, or add a GBP column to the extract." : "Add the missing dates to the extract.", detail);
  }
  return check("facility", "Trade facility", OK,
    `${procurement} procurement drawing${procurement === 1 ? "" : "s"}, all priced and dated.`, null, detail);
}

// ---- FX ----
// needed: currencies actually in use; rates: [{currency, rate_type, rate}]
export function fxCheck(needed = [], rates = null) {
  if (rates == null) return check("fx", "Exchange rates", FAIL, "The FX rate table is missing.", "Apply the FX migration.");
  const spot = new Set(rates.filter((r) => String(r.rate_type).toUpperCase() === "SPOT")
    .map((r) => String(r.currency).toUpperCase()));
  const want = [...new Set(needed.map((c) => String(c || "").toUpperCase()).filter((c) => c && c !== "GBP"))];
  const missing = want.filter((c) => !spot.has(c));
  const detail = rates.map((r) => ({ label: `${String(r.currency).toUpperCase()} ${String(r.rate_type).toUpperCase()}`, value: String(r.rate) }));
  if (!want.length) return check("fx", "Exchange rates", OK, "No foreign currency in use.", null, detail);
  if (missing.length) {
    return check("fx", "Exchange rates", WARN,
      `No SPOT rate for ${missing.join(", ")} — amounts in ${missing.length === 1 ? "that currency" : "those currencies"} cannot be converted.`,
      "Procurement Requests → Exchange rates.", detail);
  }
  return check("fx", "Exchange rates", OK, `SPOT set for ${want.join(", ")}.`, null, detail);
}

// ---- Procurement budgets ----
// budgets: [{source, ym}]
export function budgetCheck(budgets = null) {
  if (budgets == null) return check("budgets", "Procurement budgets", FAIL, "The budget table is missing.", "Apply migration 016_procurement.sql.");
  const bySource = {};
  for (const b of budgets) (bySource[b.source] ||= []).push(b.ym);
  const detail = Object.entries(bySource).map(([src, yms]) => {
    const sorted = [...yms].sort();
    return { label: src, value: `${sorted.length} month${sorted.length === 1 ? "" : "s"}`, note: `${sorted[0]} → ${sorted[sorted.length - 1]}` };
  });
  const sources = Object.keys(bySource);
  if (!sources.length) {
    return check("budgets", "Procurement budgets", WARN, "No budgets set, so every month reads “no budget”.",
      "Procurement Summary + Close → Budgets.");
  }
  const missing = ["MINISO", "LOCAL"].filter((s) => !sources.includes(s));
  if (missing.length) {
    return check("budgets", "Procurement budgets", WARN, `No budget for ${missing.join(" or ")}.`,
      "Procurement Summary + Close → Budgets.", detail);
  }
  return check("budgets", "Procurement budgets", OK, `Set for ${sources.join(" and ")}.`, null, detail);
}

// ---- Payment method tagging ----
export function paymentMethodCheck({ paid = 0, tagged = 0 } = {}) {
  if (!paid) return check("payment", "Payment method", OK, "No paid procurement invoices yet.");
  const untagged = paid - tagged;
  if (untagged > 0) {
    return check("payment", "Payment method", WARN,
      `${untagged} of ${paid} paid purchase${paid === 1 ? "" : "s"} not tagged Cash or Trade pay.`,
      "Procurement Summary + Close → set “Paid via…”. Untagged rows are left out of Cash spend rather than guessed at.");
  }
  return check("payment", "Payment method", OK, `All ${paid} paid purchases tagged.`);
}

// The worst status across the checks — what the page leads with.
export function overallStatus(checks = []) {
  if (checks.some((c) => c.status === FAIL)) return FAIL;
  if (checks.some((c) => c.status === WARN)) return WARN;
  return OK;
}

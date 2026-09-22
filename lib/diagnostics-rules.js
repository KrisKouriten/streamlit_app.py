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

/*
 * Procurement — pure, unit-testable. Supplier payment terms decide when cash
 * leaves: cash-out month = the month the invoice falls due (order month-end +
 * terms days). Committed spend is then summarised by cash-out month per source
 * and compared to that month's cash budget — the merch team's budget control.
 */

import { parseCsv } from "./intercompany-rules.js";

export const SOURCES = {
  MINISO: "Miniso purchases",
  LOCAL: "Local purchases",
};

// order_ym 'YYYY-MM' + terms days → cash-out 'YYYY-MM'. Uses month-end as the
// invoice date (goods received end of order month), then adds the terms.
export function cashOutYm(orderYm, termsDays) {
  const m = /^(\d{4})-(\d{2})$/.exec(orderYm || "");
  if (!m) return orderYm;
  const y = +m[1], mo = +m[2];
  // last day of the order month, then + terms days
  const end = new Date(Date.UTC(y, mo, 0));            // day 0 of next month = last day of this month
  end.setUTCDate(end.getUTCDate() + (Number(termsDays) || 0));
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}`;
}

// purchases: [{source, supplier, category, order_ym, amount_gbp, terms_days, status}]
// budgets:   [{source, ym, budget_gbp}]
// Returns per source: months[] (cash-out ym → committed, paid, budget, variance),
// suppliers[] (terms + committed), totals.
export function summarise(purchases, budgets) {
  const out = {};
  for (const key of Object.keys(SOURCES)) {
    const mine = purchases.filter((p) => p.source === key);
    const byMonth = {};
    const bySupplier = {};
    for (const p of mine) {
      const amt = Number(p.amount_gbp) || 0;
      const ym = cashOutYm(p.order_ym, p.terms_days);
      (byMonth[ym] ||= { ym, committed: 0, paid: 0 });
      byMonth[ym].committed += amt;
      if (p.status === "PAID") byMonth[ym].paid += amt;
      const s = (bySupplier[p.supplier] ||= { supplier: p.supplier, terms_days: Number(p.terms_days) || 0, committed: 0, orders: 0 });
      s.committed += amt; s.orders += 1; s.terms_days = Number(p.terms_days) || 0;
    }
    const bud = {};
    for (const b of budgets.filter((b) => b.source === key)) bud[b.ym] = Number(b.budget_gbp) || 0;
    const yms = [...new Set([...Object.keys(byMonth), ...Object.keys(bud)])].sort();
    const months = yms.map((ym) => {
      const committed = byMonth[ym]?.committed || 0;
      const budget = bud[ym] ?? null;
      return {
        ym, committed, paid: byMonth[ym]?.paid || 0, budget,
        variance: budget == null ? null : budget - committed,       // +ve = headroom
        overBudget: budget != null && committed > budget,
      };
    });
    const suppliers = Object.values(bySupplier).sort((a, b) => b.committed - a.committed);
    out[key] = {
      months, suppliers,
      totalCommitted: mine.reduce((s, p) => s + (Number(p.amount_gbp) || 0), 0),
      totalBudget: Object.values(bud).reduce((s, v) => s + v, 0),
    };
  }
  return out;
}

// --- CSV: Source, Supplier, Category, Order Month, Amount, Terms (days), Status, Reference
export const PROCUREMENT_CSV_TEMPLATE = "Source,Supplier,Category,Order Month,Amount,Terms (days),Status,Reference";

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[£$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function parseProcurementCsv(text) {
  const { headers, records } = parseCsv(text);
  const h = headers.map((x) => x.toLowerCase().trim());
  const col = (...frags) => { const i = h.findIndex((x) => frags.some((f) => x.includes(f))); return i < 0 ? null : headers[i]; };
  const cSrc = col("source"), cSup = col("supplier"), cCat = col("category"),
    cYm = col("order month", "month", "order"), cAmt = col("amount", "value"),
    cTerms = col("terms"), cStatus = col("status"), cRef = col("reference", "ref", "po");
  const out = [], errors = [];
  records.forEach((r, idx) => {
    let source = String(r[cSrc] || "").trim().toUpperCase();
    if (source.startsWith("MINISO")) source = "MINISO";
    else if (source.startsWith("LOCAL")) source = "LOCAL";
    const supplier = cSup ? String(r[cSup] || "").trim() : "";
    const amount = num(r[cAmt]);
    const ymRaw = cYm ? String(r[cYm] || "").trim() : "";
    const ym = /^(\d{4})-(\d{2})/.test(ymRaw) ? ymRaw.slice(0, 7)
      : (/^(\d{1,2})\/(\d{4})$/.test(ymRaw) ? `${ymRaw.split("/")[1]}-${ymRaw.split("/")[0].padStart(2, "0")}` : null);
    if (!["MINISO", "LOCAL"].includes(source)) { errors.push({ row: idx + 2, reason: "Source must be Miniso or Local" }); return; }
    if (!supplier) { errors.push({ row: idx + 2, reason: "missing supplier" }); return; }
    if (amount == null) { errors.push({ row: idx + 2, reason: "missing amount" }); return; }
    if (!ym) { errors.push({ row: idx + 2, reason: `unreadable order month "${ymRaw}" (use YYYY-MM)` }); return; }
    const status = /paid/i.test(String(r[cStatus] || "")) ? "PAID" : "COMMITTED";
    out.push({
      source, supplier, category: cCat ? String(r[cCat] || "").trim() || null : null,
      order_ym: ym, amount_gbp: amount, terms_days: Math.max(0, Math.round(num(cTerms ? r[cTerms] : 0) || 0)),
      status, reference: cRef ? String(r[cRef] || "").trim() || null : null,
    });
  });
  return { records: out, errors };
}

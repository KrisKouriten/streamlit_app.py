/*
 * Suppliers & credit — pure rules. No imports, no DB. Canonical supplier naming
 * plus the "orders vs credit limit" headroom maths. Unit-tested in
 * tests/suppliers-rules.test.mjs.
 */

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The match/dedup key for a supplier name: lowercase, trimmed, inner whitespace
// collapsed. "Miniso HQ " and "miniso  hq" → "miniso hq".
export function normName(s) {
  return String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
}

export function validateSupplier(i = {}) {
  const errors = [];
  const name = String(i.name || "").trim().replace(/\s+/g, " ");
  if (!name) errors.push("Supplier name is required");
  const credit_limit = num(i.credit_limit);
  if (i.credit_limit != null && i.credit_limit !== "" && (credit_limit == null || credit_limit < 0)) {
    errors.push("Credit limit must be a positive number (or blank for none)");
  }
  const currency = /^[A-Za-z]{3}$/.test(String(i.currency || "")) ? String(i.currency).toUpperCase() : "GBP";
  const id = i.id ? Number(i.id) : null;
  return {
    errors,
    clean: {
      id: Number.isFinite(id) ? id : null,
      name,
      norm_name: normName(name),
      source_type: i.source_type ? String(i.source_type).trim().toUpperCase() : null,
      currency,
      credit_limit,
      active: i.active === false ? false : true,
      notes: String(i.notes || "").trim() || null,
    },
  };
}

// Headroom for one exposure against a limit. exposure = open order commitment
// (+ any facility outstanding). Returns nulls when no limit is set.
export function headroom(limit, exposure) {
  const l = num(limit);
  const e = r2(exposure);
  if (l == null) return { limit: null, exposure: e, headroom: null, utilisation: null, over: false, near: false };
  const hr = r2(l - e);
  const util = l > 0 ? Math.round((e / l) * 1000) / 1000 : null;
  return { limit: r2(l), exposure: e, headroom: hr, utilisation: util, over: e > l, near: util != null && util >= 0.9 && e <= l };
}

// Roll a list of per-supplier exposure rows into a report + totals.
// Each row in: { supplier_id, name, credit_limit, orderExposure, facilityOutstanding }.
export function summariseExposure(rows = []) {
  const out = rows.map((row) => {
    const exposure = r2((Number(row.orderExposure) || 0) + (Number(row.facilityOutstanding) || 0));
    return {
      supplier_id: row.supplier_id,
      name: row.name,
      credit_limit: num(row.credit_limit),
      orderExposure: r2(row.orderExposure),
      facilityOutstanding: r2(row.facilityOutstanding),
      ...headroom(row.credit_limit, exposure),
    };
  });
  const withLimit = out.filter((r) => r.limit != null);
  const totals = {
    suppliers: out.length,
    withLimit: withLimit.length,
    totalExposure: r2(out.reduce((t, r) => t + r.exposure, 0)),
    totalLimit: r2(withLimit.reduce((t, r) => t + (r.limit || 0), 0)),
    overLimit: out.filter((r) => r.over).length,
    nearLimit: out.filter((r) => r.near).length,
  };
  totals.totalHeadroom = r2(totals.totalLimit - r2(withLimit.reduce((t, r) => t + r.exposure, 0)));
  // Worst utilisation first, then biggest exposure — the review order finance wants.
  out.sort((a, b) => (b.utilisation ?? -1) - (a.utilisation ?? -1) || b.exposure - a.exposure);
  return { rows: out, totals };
}

// Facility-level headroom (e.g. the HSBC facility): limit vs total outstanding drawings.
export function facilityHeadroom(limit, outstanding) {
  return headroom(limit, outstanding);
}

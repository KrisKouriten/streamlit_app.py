import * as XLSX from "xlsx";
import { query } from "./db";
import { audit } from "./governance";
import { parseCostModelWorkbook } from "./cost-model-rules.js";

/*
 * Store cost model — the per-store fixed / variable / labour expectation that
 * drives the accrual review's "variance versus actuals" basis. Base
 * expectations live in finance.store_cost_expectation; month-varying rates
 * (monthly COGS override, seasonal labour) in finance.store_cost_rate_month.
 * Uploaded on Data Uploads, read by the Management Accounts Close. Degrades
 * gracefully before migrations 078 / 079.
 */

const tableMissing = (e) => e?.code === "42P01";
const columnMissing = (e) => e?.code === "42703";

export async function getStoreCostModel() {
  try {
    const { rows } = await query(
      `SELECT store, line_label, behaviour, monthly_amount, pct_of_revenue, start_ym, updated_at
       FROM finance.store_cost_expectation ORDER BY store, line_label`
    );
    let rateCount = 0;
    try {
      const { rows: rr } = await query(`SELECT count(*)::int AS n FROM finance.store_cost_rate_month`);
      rateCount = rr[0]?.n || 0;
    } catch (e) { if (!tableMissing(e)) throw e; }
    const stores = [...new Set(rows.map((r) => r.store))].sort();
    return {
      ready: true, loaded: rows.length > 0, rows, stores,
      counts: {
        lines: rows.length, stores: stores.length,
        fixed: rows.filter((r) => r.behaviour === "FIXED").length,
        variable: rows.filter((r) => r.behaviour === "VARIABLE").length,
        monthRates: rateCount,
      },
    };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false, rows: [], stores: [], counts: { lines: 0, stores: 0, fixed: 0, variable: 0, monthRates: 0 } };
    if (columnMissing(e)) {
      // Pre-079: read without start_ym.
      const { rows } = await query(`SELECT store, line_label, behaviour, monthly_amount, pct_of_revenue, updated_at FROM finance.store_cost_expectation ORDER BY store, line_label`);
      const stores = [...new Set(rows.map((r) => r.store))].sort();
      return { ready: true, loaded: rows.length > 0, rows, stores, counts: { lines: rows.length, stores: stores.length, fixed: rows.filter((r) => r.behaviour === "FIXED").length, variable: rows.filter((r) => r.behaviour === "VARIABLE").length, monthRates: 0 } };
    }
    throw e;
  }
}

// Shaped for the accrual engine: { base:[…], monthRates:[…] }.
export async function getCostExpectations() {
  let base = [];
  try {
    const { rows } = await query(`SELECT store, line_label, behaviour, monthly_amount, pct_of_revenue, start_ym FROM finance.store_cost_expectation`);
    base = rows.map((r) => ({
      store: r.store, line_label: r.line_label, behaviour: r.behaviour,
      monthly_amount: r.monthly_amount == null ? null : Number(r.monthly_amount),
      pct_of_revenue: r.pct_of_revenue == null ? null : Number(r.pct_of_revenue),
      start_ym: r.start_ym || null,
    }));
  } catch (e) {
    if (tableMissing(e)) return { base: [], monthRates: [] };
    if (columnMissing(e)) {
      const { rows } = await query(`SELECT store, line_label, behaviour, monthly_amount, pct_of_revenue FROM finance.store_cost_expectation`);
      base = rows.map((r) => ({ store: r.store, line_label: r.line_label, behaviour: r.behaviour, monthly_amount: r.monthly_amount == null ? null : Number(r.monthly_amount), pct_of_revenue: r.pct_of_revenue == null ? null : Number(r.pct_of_revenue), start_ym: null }));
    } else throw e;
  }
  let monthRates = [];
  try {
    const { rows } = await query(`SELECT store, line_label, scope, period_key, pct_of_revenue FROM finance.store_cost_rate_month`);
    monthRates = rows.map((r) => ({ store: r.store, line_label: r.line_label, scope: r.scope, period_key: r.period_key, pct_of_revenue: r.pct_of_revenue == null ? null : Number(r.pct_of_revenue) }));
  } catch (e) { if (!tableMissing(e)) throw e; }
  return { base, monthRates };
}

// Insert rows in batches of `size` via a single multi-row VALUES statement each.
async function batchInsert(sql, rows, cols, size = 200) {
  for (let s = 0; s < rows.length; s += size) {
    const chunk = rows.slice(s, s + size);
    const params = [];
    const values = chunk.map((row, ri) => "(" + cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(",") + ")").join(",");
    for (const row of chunk) for (const c of cols) params.push(row[c]);
    await query(sql + values, params);
  }
}

export async function ingestCostModelWorkbook(buffer, actor) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  wb._utils = XLSX.utils;
  const { records, monthRates, warnings, stores } = parseCostModelWorkbook(wb);
  if (!records.length) {
    const reason = warnings.length ? warnings.slice(0, 3).join("; ") : "no cost-model rows found";
    throw new Error(`Cost model not loaded — ${reason}`);
  }
  try {
    // A cost-model upload is the authoritative model — replace it wholesale.
    await query(`DELETE FROM finance.store_cost_expectation`);
    try { await query(`DELETE FROM finance.store_cost_rate_month`); } catch (e) { if (!tableMissing(e)) throw e; }

    await batchInsert(
      `INSERT INTO finance.store_cost_expectation (store, line_label, behaviour, monthly_amount, pct_of_revenue, start_ym, source, updated_by) VALUES `,
      records.map((r) => ({ ...r, source: "cost model workbook", updated_by: actor })),
      ["store", "line_label", "behaviour", "monthly_amount", "pct_of_revenue", "start_ym", "source", "updated_by"]
    );
    if (monthRates.length) {
      try {
        await batchInsert(
          `INSERT INTO finance.store_cost_rate_month (store, line_label, scope, period_key, pct_of_revenue, updated_by) VALUES `,
          monthRates.map((r) => ({ ...r, updated_by: actor })),
          ["store", "line_label", "scope", "period_key", "pct_of_revenue", "updated_by"]
        );
      } catch (e) { if (!tableMissing(e)) throw e; }
    }
  } catch (e) {
    if (tableMissing(e)) throw new Error("Run migrations 078 and 079 before uploading the cost model.");
    if (columnMissing(e)) throw new Error("Run migration 079_cost_model_rates.sql before uploading this workbook.");
    throw e;
  }
  const fixed = records.filter((r) => r.behaviour === "FIXED").length;
  const detail = { loaded: records.length, stores: stores.length, fixed, variable: records.length - fixed, monthRates: monthRates.length, warnings };
  await audit({ actor, eventType: "cost_model.upload", objectType: "store_cost_expectation", objectRef: "workbook", detail });
  return detail;
}

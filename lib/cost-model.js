import * as XLSX from "xlsx";
import { query } from "./db";
import { audit } from "./governance";
import { parseCostModelWorkbook } from "./cost-model-rules.js";

/*
 * Store cost model — the per-store fixed / variable cost expectation that drives
 * the accrual review's "variance versus actuals" basis. Lives in
 * finance.store_cost_expectation; uploaded on Data Uploads, read by the
 * Management Accounts Close. Degrades gracefully before migration 078.
 */

const tableMissing = (e) => e?.code === "42P01";

export async function getStoreCostModel() {
  try {
    const { rows } = await query(
      `SELECT store, line_label, behaviour, monthly_amount, pct_of_revenue, updated_at
       FROM finance.store_cost_expectation
       ORDER BY store, line_label`
    );
    const stores = [...new Set(rows.map((r) => r.store))].sort();
    return {
      ready: true, loaded: rows.length > 0, rows, stores,
      counts: { lines: rows.length, stores: stores.length, fixed: rows.filter((r) => r.behaviour === "FIXED").length, variable: rows.filter((r) => r.behaviour === "VARIABLE").length },
    };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false, rows: [], stores: [], counts: { lines: 0, stores: 0, fixed: 0, variable: 0 } };
    throw e;
  }
}

// Expectations shaped for the accrual engine — numeric monthly_amount / rate.
export async function getCostExpectations() {
  const { rows } = await getStoreCostModel();
  return rows.map((r) => ({
    store: r.store, line_label: r.line_label, behaviour: r.behaviour,
    monthly_amount: r.monthly_amount == null ? null : Number(r.monthly_amount),
    pct_of_revenue: r.pct_of_revenue == null ? null : Number(r.pct_of_revenue),
  }));
}

async function upsertExpectations(records, source, actor) {
  for (const r of records) {
    await query(
      `INSERT INTO finance.store_cost_expectation (store, line_label, behaviour, monthly_amount, pct_of_revenue, source, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (store, line_label)
       DO UPDATE SET behaviour = EXCLUDED.behaviour, monthly_amount = EXCLUDED.monthly_amount,
                     pct_of_revenue = EXCLUDED.pct_of_revenue, source = EXCLUDED.source,
                     updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [r.store, r.line_label, r.behaviour, r.monthly_amount, r.pct_of_revenue, source, actor]
    );
  }
}

export async function ingestCostModelWorkbook(buffer, actor) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  wb._utils = XLSX.utils;
  const { records, warnings, stores } = parseCostModelWorkbook(wb);
  if (!records.length) {
    const reason = warnings.length ? warnings.slice(0, 3).join("; ") : "no cost-model rows found";
    throw new Error(`Cost model not loaded — ${reason}`);
  }
  try {
    await upsertExpectations(records, "cost model workbook", actor);
  } catch (e) {
    if (tableMissing(e)) throw new Error("Run migration 078_store_cost_model.sql before uploading the cost model.");
    throw e;
  }
  const fixed = records.filter((r) => r.behaviour === "FIXED").length;
  await audit({ actor, eventType: "cost_model.upload", objectType: "store_cost_expectation", objectRef: "workbook", detail: { loaded: records.length, stores: stores.length, fixed, variable: records.length - fixed, warnings } });
  return { loaded: records.length, stores: stores.length, fixed, variable: records.length - fixed, warnings };
}

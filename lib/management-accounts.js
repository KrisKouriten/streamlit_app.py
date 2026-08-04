import * as XLSX from "xlsx";
import { query } from "./db";
import { audit } from "./governance";
import { parseActualsWorkbook, computeMgmtAccounts } from "./actuals-rules.js";
import { computeAccrualReview, DEFAULT_MATERIALITY } from "./accrual-rules.js";
import { getCostExpectations } from "./cost-model";

/*
 * Management accounts — store-level actuals uploaded from Excel, blended with the
 * forecast (which doubles as budget): actuals lead any month they cover, the
 * forecast carries forward months. Actuals live in finance.mgmt_actual; the
 * budget/forecast in finance.forecast_line.
 */

const tableMissing = (e) => e?.code === "42P01";
const columnMissing = (e) => e?.code === "42703";

async function fetchForecastLines() {
  try {
    const { rows } = await query(`SELECT scope, unit, entity, line_label, cost_type, ym, value FROM finance.forecast_line`);
    return rows;
  } catch (e) {
    if (columnMissing(e)) { const { rows } = await query(`SELECT scope, unit, line_label, cost_type, ym, value FROM finance.forecast_line`); return rows.map((r) => ({ ...r, entity: null })); }
    if (tableMissing(e)) return [];
    throw e;
  }
}

export async function getManagementAccounts({ unit = null } = {}) {
  let actuals = [];
  try {
    const { rows } = await query(`SELECT scope, entity, unit, line_label, ym, value FROM finance.mgmt_actual`);
    actuals = rows;
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false };
    throw e;
  }
  const forecastLines = await fetchForecastLines();
  if (!actuals.length && !forecastLines.length) return { ready: true, loaded: false };

  const ma = computeMgmtAccounts(forecastLines, actuals, { scope: "STORES", unit });
  // store list for the selector (union of forecast + actual stores)
  const stores = [...new Set([
    ...forecastLines.filter((l) => l.scope === "STORES" && l.unit).map((l) => l.unit),
    ...actuals.filter((a) => a.unit).map((a) => a.unit),
  ])].sort();

  return {
    ready: true, loaded: true, ma, stores,
    hasActuals: actuals.length > 0,
    counts: { actuals: actuals.length, forecast: forecastLines.length },
  };
}

// Run-rate accrual review — reads the uploaded store P&L actuals and, for a
// target month, compares each store × nominal against its trailing same-year
// run-rate to surface the lines that still need an accrual (nothing posted /
// reversed / under-posted). This is the month-end provisional-accounts check
// on the raw store P&Ls, distinct from the GL pre-close model. Degrades to an
// unready shell before the actuals table exists.
export async function getAccrualReview({ targetMonth = null, materiality = DEFAULT_MATERIALITY } = {}) {
  let records = [];
  try {
    const { rows } = await query(
      `SELECT unit, line_label, ym, value FROM finance.mgmt_actual WHERE scope = 'STORES'`
    );
    records = rows;
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false };
    throw e;
  }
  if (!records.length) return { ready: true, loaded: false };
  const expectations = await getCostExpectations().catch(() => []);
  const review = computeAccrualReview(records, { targetMonth, materiality: Number(materiality) || DEFAULT_MATERIALITY, expectations });
  return { ready: true, loaded: true, ...review };
}

// A store P&L workbook is thousands of rows; insert them in batched multi-row
// statements rather than one round-trip each (which times out against a hosted
// DB). Rows are first collapsed on the conflict key — last value wins, matching
// the single-row upsert — so a batch never hits the same key twice (which
// Postgres rejects in one ON CONFLICT statement).
async function upsertActuals(records, source, actor) {
  const byKey = new Map();
  for (const r of records) {
    const scope = r.scope || "STORES";
    const unit = r.unit ?? null;
    byKey.set(`${scope}||${unit ?? ""}||${r.line_label}||${r.ym}`, { scope, entity: r.entity ?? null, unit, line_label: r.line_label, ym: r.ym, value: r.value });
  }
  const rows = [...byKey.values()];
  const COLS = 8;
  const BATCH = 400;
  for (let s = 0; s < rows.length; s += BATCH) {
    const chunk = rows.slice(s, s + BATCH);
    const values = chunk.map((_, i) => `($${i * COLS + 1},$${i * COLS + 2},$${i * COLS + 3},$${i * COLS + 4},$${i * COLS + 5},$${i * COLS + 6},$${i * COLS + 7},$${i * COLS + 8})`).join(",");
    const params = [];
    for (const r of chunk) params.push(r.scope, r.entity, r.unit, r.line_label, r.ym, r.value, source, actor);
    await query(
      `INSERT INTO finance.mgmt_actual (scope, entity, unit, line_label, ym, value, source, updated_by)
       VALUES ${values}
       ON CONFLICT (scope, COALESCE(unit,''), line_label, ym)
       DO UPDATE SET value = EXCLUDED.value, entity = COALESCE(EXCLUDED.entity, finance.mgmt_actual.entity),
                     source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      params
    );
  }
}

// Which fiscal years of actuals are loaded — powers the per-year view on the
// Data Uploads hub. Each year is a distinct set of months; uploading one year
// never overwrites another (upsert is keyed by ym). Degrades pre-migration.
export async function getLoadedActualYears() {
  try {
    const { rows } = await query(
      `SELECT left(ym, 4) AS year,
              count(DISTINCT ym)::int AS months,
              count(*)::int AS rows,
              max(updated_at) AS updated_at
       FROM finance.mgmt_actual
       GROUP BY left(ym, 4)
       ORDER BY year DESC`
    );
    return { ready: true, years: rows };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, years: [] };
    throw e;
  }
}

export async function ingestActualsWorkbook(buffer, actor) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  wb._utils = XLSX.utils;
  const { records, warnings, months } = parseActualsWorkbook(wb);
  if (!records.length) {
    const reason = warnings.length ? warnings.slice(0, 3).join("; ") : "no actual rows found";
    throw new Error(`Actuals not loaded — ${reason}`);
  }
  try {
    await upsertActuals(records, "MA workbook", actor);
  } catch (e) {
    if (tableMissing(e)) throw new Error("Run migration 019_mgmt_actual.sql before uploading actuals.");
    throw e;
  }
  const stores = new Set(records.filter((r) => r.unit).map((r) => r.unit));
  // Guard against a flattened export — a store P&L that resolves to a single
  // store across hundreds of lines almost always means the Store column was
  // filled down to one value. Surface it rather than silently loading it all
  // under one store.
  if (stores.size <= 1 && records.length > 400) {
    warnings.unshift(`All ${records.length.toLocaleString("en-GB")} lines are under a single store (${[...stores][0] || "—"}) — the Store column looks flattened. Check the export before relying on this load.`);
  }
  await audit({ actor, eventType: "mgmt_accounts.actuals", objectType: "mgmt_actual", objectRef: "workbook", detail: { loaded: records.length, stores: stores.size, months: months.length, warnings } });
  return { loaded: records.length, stores: stores.size, months: months.length, warnings };
}

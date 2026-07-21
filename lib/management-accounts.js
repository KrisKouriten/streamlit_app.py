import * as XLSX from "xlsx";
import { query } from "./db";
import { audit } from "./governance";
import { parseActualsWorkbook, computeMgmtAccounts } from "./actuals-rules.js";

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

async function upsertActuals(records, source, actor) {
  for (const r of records) {
    await query(
      `INSERT INTO finance.mgmt_actual (scope, entity, unit, line_label, ym, value, source, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (scope, COALESCE(unit,''), line_label, ym)
       DO UPDATE SET value = EXCLUDED.value, entity = COALESCE(EXCLUDED.entity, finance.mgmt_actual.entity),
                     source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [r.scope || "STORES", r.entity ?? null, r.unit ?? null, r.line_label, r.ym, r.value, source, actor]
    );
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
  await audit({ actor, eventType: "mgmt_accounts.actuals", objectType: "mgmt_actual", objectRef: "workbook", detail: { loaded: records.length, stores: stores.size, months: months.length, warnings } });
  return { loaded: records.length, stores: stores.size, months: months.length, warnings };
}

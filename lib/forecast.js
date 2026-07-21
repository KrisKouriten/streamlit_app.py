import * as XLSX from "xlsx";
import { query } from "./db";
import { audit } from "./governance";
import { computeForecast, parseForecastCsv, parseForecastWorkbook } from "./forecast-rules.js";

/*
 * Operate forecast — DB layer. Inputs live in finance.forecast_line; scenarios
 * in finance.forecast_scenario. Pages get computed aggregates, not raw lines.
 */

const tableMissing = (e) => e?.code === "42P01";
const columnMissing = (e) => e?.code === "42703";

// Read the forecast lines. The `entity` column arrives in migration 018; until
// it's run (e.g. a database still on 017), fall back to selecting without it so
// the screen keeps working — the store→entity rollup just stays empty until the
// migration lands and a workbook with entities is loaded.
async function fetchLines() {
  try {
    const { rows } = await query(`SELECT scope, unit, entity, line_label, cost_type, ym, value FROM finance.forecast_line`);
    return rows;
  } catch (e) {
    if (!columnMissing(e)) throw e;
    const { rows } = await query(`SELECT scope, unit, line_label, cost_type, ym, value FROM finance.forecast_line`);
    return rows.map((r) => ({ ...r, entity: null }));
  }
}

export async function getForecast() {
  try {
    const [lines, { rows: scenarios }] = await Promise.all([
      fetchLines(),
      query(`SELECT scenario_id, name, sales_pct, variable_pct, fixed_pct, notes FROM finance.forecast_scenario WHERE is_active ORDER BY scenario_id`),
    ]);
    if (!lines.length) return { ready: true, loaded: false, scenarios, base: null, storeSales: [], byEntity: [], counts: {} };

    const base = computeForecast(lines);
    // per-store FY sales (top-line view for the stores tab), carrying the entity
    // the store rolls up to; and an entity rollup below it.
    const storeSales = {};
    const storeEntity = {};
    for (const l of lines) {
      if (l.scope === "STORES" && l.cost_type === "SALES" && l.ym) {
        storeSales[l.unit] = (storeSales[l.unit] || 0) + Number(l.value);
        if (l.entity) storeEntity[l.unit] = l.entity;
      }
    }
    const entityTotals = {};
    for (const [store, sales] of Object.entries(storeSales)) {
      const e = storeEntity[store] || "Unassigned";
      (entityTotals[e] ||= { entity: e, sales: 0, stores: 0 });
      entityTotals[e].sales += sales;
      entityTotals[e].stores += 1;
    }
    const counts = {};
    for (const l of lines) counts[l.scope] = (counts[l.scope] || 0) + 1;
    return {
      ready: true, loaded: true, scenarios, base,
      storeSales: Object.entries(storeSales).map(([store, sales]) => ({ store, entity: storeEntity[store] || null, sales })).sort((a, b) => b.sales - a.sales),
      byEntity: Object.values(entityTotals).sort((a, b) => b.sales - a.sales),
      counts,
    };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false, scenarios: [], base: null, storeSales: [], byEntity: [], counts: {} };
    throw e;
  }
}

// Upsert a set of parsed lines (from CSV or a single manual edit).
async function upsertLines(records, source, actor) {
  for (const r of records) {
    try {
      await query(
        `INSERT INTO finance.forecast_line (scope, unit, entity, line_label, cost_type, ym, value, source, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (scope, COALESCE(unit,''), line_label, cost_type, COALESCE(ym,''))
         DO UPDATE SET value = EXCLUDED.value, entity = COALESCE(EXCLUDED.entity, finance.forecast_line.entity),
                       source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [r.scope, r.unit ?? null, r.entity ?? null, r.line_label, r.cost_type, r.ym ?? null, r.value, source, actor]
      );
    } catch (e) {
      if (columnMissing(e)) throw new Error("Run migration 018_forecast_entity.sql before uploading — it adds the store → entity column the forecast needs.");
      throw e;
    }
  }
}

export async function ingestForecastCsv(csvText, actor) {
  const { records, errors } = parseForecastCsv(csvText);
  if (!records.length) {
    const reason = errors.length ? `${errors.length} row error(s): ${errors.slice(0, 3).map((e) => `row ${e.row} ${e.reason}`).join("; ")}` : "no valid rows";
    throw new Error(`Forecast not loaded — ${reason}`);
  }
  await upsertLines(records, "CSV upload", actor);
  await audit({ actor, eventType: "forecast.upload", objectType: "forecast_line", objectRef: "csv", detail: { loaded: records.length, rowErrors: errors.length } });
  return { loaded: records.length, errors };
}

// 3-tab store forecast workbook (Sales Forecast · Cost Assumptions · Labour
// Seasonality). Amend + add (upsert) on the same grain as CSV — stores/months
// present are updated, new ones added, everything else left untouched, so
// partial uploads are welcome.
export async function ingestForecastWorkbook(buffer, actor) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  wb._utils = XLSX.utils;
  const { records, storeEntity, warnings, months } = parseForecastWorkbook(wb);
  if (!records.length) {
    const reason = warnings.length ? warnings.slice(0, 3).join("; ") : "no forecast rows found in the workbook";
    throw new Error(`Forecast not loaded — ${reason}`);
  }
  await upsertLines(records, "Workbook upload", actor);
  const stores = new Set(records.filter((r) => r.unit).map((r) => r.unit));
  const entities = new Set(Object.values(storeEntity));
  await audit({ actor, eventType: "forecast.workbook", objectType: "forecast_line", objectRef: "workbook", detail: { loaded: records.length, stores: stores.size, entities: entities.size, months: months.length, warnings } });
  return { loaded: records.length, stores: stores.size, entities: entities.size, months: months.length, warnings };
}

export async function setForecastLine({ scope, unit, line_label, cost_type, ym, value }, actor) {
  await upsertLines([{ scope, unit: unit || null, line_label, cost_type, ym: ym || null, value }], "Manual entry", actor);
  await audit({ actor, eventType: "forecast.set", objectType: "forecast_line", objectRef: `${scope}·${unit || "-"}·${line_label}·${ym || "rate"}`, detail: { value } });
}

export async function saveScenario({ name, sales_pct, variable_pct, fixed_pct, notes }, actor) {
  await query(
    `INSERT INTO finance.forecast_scenario (name, sales_pct, variable_pct, fixed_pct, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (name) DO UPDATE SET sales_pct = EXCLUDED.sales_pct, variable_pct = EXCLUDED.variable_pct,
       fixed_pct = EXCLUDED.fixed_pct, notes = EXCLUDED.notes, is_active = true`,
    [name, sales_pct || 0, variable_pct || 0, fixed_pct || 0, notes || null, actor]
  );
  await audit({ actor, eventType: "forecast.scenario", objectType: "forecast_scenario", objectRef: name, detail: { sales_pct, variable_pct, fixed_pct } });
}

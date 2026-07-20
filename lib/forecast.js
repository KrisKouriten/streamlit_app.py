import { query } from "./db";
import { audit } from "./governance";
import { computeForecast, parseForecastCsv } from "./forecast-rules.js";

/*
 * Operate forecast — DB layer. Inputs live in finance.forecast_line; scenarios
 * in finance.forecast_scenario. Pages get computed aggregates, not raw lines.
 */

const tableMissing = (e) => e?.code === "42P01";

export async function getForecast() {
  try {
    const [{ rows: lines }, { rows: scenarios }] = await Promise.all([
      query(`SELECT scope, unit, line_label, cost_type, ym, value FROM finance.forecast_line`),
      query(`SELECT scenario_id, name, sales_pct, variable_pct, fixed_pct, notes FROM finance.forecast_scenario WHERE is_active ORDER BY scenario_id`),
    ]);
    if (!lines.length) return { ready: true, loaded: false, scenarios, base: null, storeSales: [], counts: {} };

    const base = computeForecast(lines);
    // per-store FY sales (top-line view for the stores tab)
    const storeSales = {};
    for (const l of lines) {
      if (l.scope === "STORES" && l.cost_type === "SALES" && l.ym) {
        storeSales[l.unit] = (storeSales[l.unit] || 0) + Number(l.value);
      }
    }
    const counts = {};
    for (const l of lines) counts[l.scope] = (counts[l.scope] || 0) + 1;
    return {
      ready: true, loaded: true, scenarios, base,
      storeSales: Object.entries(storeSales).map(([store, sales]) => ({ store, sales })).sort((a, b) => b.sales - a.sales),
      counts,
    };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false, scenarios: [], base: null, storeSales: [], counts: {} };
    throw e;
  }
}

// Upsert a set of parsed lines (from CSV or a single manual edit).
async function upsertLines(records, source, actor) {
  for (const r of records) {
    await query(
      `INSERT INTO finance.forecast_line (scope, unit, line_label, cost_type, ym, value, source, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (scope, COALESCE(unit,''), line_label, cost_type, COALESCE(ym,''))
       DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source,
                     updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [r.scope, r.unit, r.line_label, r.cost_type, r.ym, r.value, source, actor]
    );
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

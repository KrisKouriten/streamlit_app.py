/*
 * Pricing Scenario — DB layer (migration 069). Scenarios never overwrite the live
 * pricing master; they hold proposed prices and read cost + current price from
 * pricing.sku_price + commercial.sku_metric. All maths is in
 * pricing-scenario-rules.js. Degrades to []/null before the schema exists.
 */

import { query } from "./db";
import { audit } from "./governance";
import { computeCostBuild, computePriceChain } from "./pricing-rules.js";
import { scenarioLine, scenarioImpact, pctOfSales, companyMarginImpact, blendedMargin, isScenarioType } from "./pricing-scenario-rules.js";

const absent = (e) => e?.code === "42P01" || e?.code === "3F000";
const actorOf = (a) => a?.email || a?.name || "system";
const safe = async (fn, fb) => { try { return await fn(); } catch (e) { if (absent(e)) return fb; throw e; } };

export async function listScenarios() {
  return safe(async () => (await query(
    `SELECT s.scenario_id, s.name, s.scenario_type, s.period_start, s.period_end, s.status, s.company_sales,
            s.created_by, s.created_at, (SELECT count(*)::int FROM pricing.scenario_line l WHERE l.scenario_id = s.scenario_id) AS line_count
       FROM pricing.scenario s ORDER BY s.created_at DESC`)).rows, []);
}

export async function createScenario(input, actor) {
  if (!input.name) throw new Error("Give the scenario a name");
  if (input.scenario_type && !isScenarioType(input.scenario_type)) throw new Error("Choose a valid scenario type");
  const { rows } = await query(
    `INSERT INTO pricing.scenario (name, scenario_type, period_start, period_end, company_sales, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING scenario_id`,
    [input.name, input.scenario_type || "PROMOTION", input.period_start || null, input.period_end || null,
     input.company_sales == null ? null : Number(input.company_sales), input.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "pricing_scenario.create", objectType: "scenario", objectRef: String(rows[0].scenario_id), detail: { name: input.name } });
  return { ok: true, scenarioId: rows[0].scenario_id };
}

// Add SKUs to a scenario — snapshots each SKU's current price + total cost + baseline
// sales from the pricing master and SKU metrics.
export async function addSkusToScenario(scenarioId, selections = [], actor) {
  let added = 0;
  for (const sel of selections) {
    const { rows } = await query(
      `SELECT p.*, m.units_ttm, m.revenue_ttm FROM pricing.sku_price p
         LEFT JOIN commercial.sku_metric m ON m.sku = p.sku_code
        WHERE p.sku_code = $1 AND p.channel_code = $2`, [sel.sku_code, sel.channel_code]);
    const p = rows[0];
    if (!p) continue;
    const build = computeCostBuild(p);
    const chain = computePriceChain(build.totalCost, { wholesaleMargin: p.wholesale_margin_pct, distributorMargin: p.distributor_margin_pct, vat: p.retail_vat_pct });
    const currentRrp = p.actual_retail_price != null ? Number(p.actual_retail_price) : chain.rrpInclVat;
    await query(
      `INSERT INTO pricing.scenario_line (scenario_id, sku_code, channel_code, description, category, current_rrp, new_rrp, vat_rate, cost_price, annual_sales, baseline_units)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10)
       ON CONFLICT (scenario_id, sku_code, channel_code) DO NOTHING`,
      [scenarioId, p.sku_code, p.channel_code, p.description, p.category, currentRrp, p.retail_vat_pct || 0.2,
       build.totalCost, p.revenue_ttm != null ? Number(p.revenue_ttm) : null, p.units_ttm != null ? Number(p.units_ttm) : null]);
    added++;
  }
  await audit({ actor, eventType: "pricing_scenario.add_skus", objectType: "scenario", objectRef: String(scenarioId), detail: { added } });
  return { ok: true, added };
}

const LINE_FIELDS = ["new_rrp", "expected_sales_increase_pct", "baseline_units", "expected_units", "category_sales", "promotion_sales", "promo_start", "promo_end"];
export async function saveScenarioLine(lineId, patch, actor) {
  const set = []; const vals = [lineId]; let i = 2;
  for (const f of LINE_FIELDS) if (patch[f] !== undefined) { set.push(`${f} = $${i++}`); vals.push(patch[f] === "" ? null : patch[f]); }
  if (!set.length) return { ok: true };
  await query(`UPDATE pricing.scenario_line SET ${set.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE line_id = $1`, vals);
  await audit({ actor, eventType: "pricing_scenario.save_line", objectType: "scenario_line", objectRef: String(lineId) });
  return { ok: true };
}

export async function deleteScenarioLine(lineId, actor) {
  await query(`DELETE FROM pricing.scenario_line WHERE line_id = $1`, [lineId]);
  await audit({ actor, eventType: "pricing_scenario.delete_line", objectType: "scenario_line", objectRef: String(lineId) });
  return { ok: true };
}

export async function setScenarioStatus(id, action, actor) {
  const to = { approve: "APPROVED", archive: "ARCHIVED", reopen: "DRAFT" }[action];
  if (!to) throw new Error(`Unknown action '${action}'`);
  const stamp = to === "APPROVED";
  await query(
    `UPDATE pricing.scenario SET status = $2, approved_by = CASE WHEN $3 THEN $4 ELSE approved_by END,
       approved_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE approved_at END, updated_at = CURRENT_TIMESTAMP
     WHERE scenario_id = $1`, [id, to, stamp, actorOf(actor)]);
  await audit({ actor, eventType: `pricing_scenario.${action}`, objectType: "scenario", objectRef: String(id), detail: { to } });
  return { ok: true, status: to };
}

// Full scenario view — each line with its margin impact, % of sales and company
// margin impact, plus the blended margin movement and dashboard KPIs.
export async function getScenario(id) {
  const scenario = await safe(async () => (await query(
    `SELECT scenario_id, name, scenario_type, period_start, period_end, status, company_sales, notes, created_by, created_at, approved_by, approved_at
       FROM pricing.scenario WHERE scenario_id = $1`, [id])).rows[0] || null, null);
  if (!scenario) return null;
  const rows = await safe(async () => (await query(`SELECT * FROM pricing.scenario_line WHERE scenario_id = $1 ORDER BY category, sku_code`, [id])).rows, []);
  const lines = rows.map((r) => {
    const impact = scenarioImpact({ currentRrp: r.current_rrp, newRrp: r.new_rrp, vat: r.vat_rate, totalCost: r.cost_price, baselineUnits: r.baseline_units, expectedUnits: r.expected_units });
    const shares = pctOfSales({ skuSales: r.annual_sales, companySales: scenario.company_sales, categorySales: r.category_sales, promotionSales: r.promotion_sales });
    const compImpact = companyMarginImpact({ companyPct: shares.companyPct, currentGpPct: impact.current.gpPct, newGpPct: impact.proposed.gpPct });
    return { ...r, impact, shares, companyMarginImpact: compImpact };
  });
  const blended = blendedMargin(lines.map((l) => ({
    salesValue: Number(l.annual_sales) || 0,
    scenarioSalesValue: l.expected_units != null && l.baseline_units ? (Number(l.annual_sales) || 0) * (Number(l.expected_units) / Number(l.baseline_units)) : Number(l.annual_sales) || 0,
    currentGpPct: l.impact.current.gpPct, newGpPct: l.impact.proposed.gpPct,
  })));
  const dashboard = {
    lineCount: lines.length,
    marginLost: Math.round(lines.reduce((t, l) => t + Math.min(0, l.impact.grossProfitMovement || 0), 0)),
    revenueMovement: Math.round(lines.reduce((t, l) => t + (l.impact.revenueMovement || 0), 0)),
    unitsMovement: Math.round(lines.reduce((t, l) => t + (l.impact.unitsMovement || 0), 0)),
    cashRecovery: Math.round(lines.reduce((t, l) => t + (l.impact.cashRecovery || 0), 0)),
    companyMarginImpact: blended.movement,
    currentBlended: blended.current, scenarioBlended: blended.scenario,
  };
  return { scenario, lines, blended, dashboard };
}

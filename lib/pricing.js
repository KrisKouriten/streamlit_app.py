/*
 * Pricing Review — DB layer. Reads/writes the pricing.sku_price master (migration
 * 068); all pricing maths lives in pricing-rules.js. Joins commercial.sku_metric
 * for the commercial view (units, revenue, cash invested) where available, and
 * computes each SKU's cost build, margin, health score and alerts on read so
 * there is one source of truth. Degrades to []/null before the schema exists.
 */

import { query } from "./db";
import { audit } from "./governance";
import { priceSku, healthBand } from "./pricing-rules.js";
import { parsePricingCsv } from "./pricing-ingest-rules.js";

const absent = (e) => e?.code === "42P01" || e?.code === "3F000";
const actorOf = (a) => a?.email || a?.name || "system";
const safe = async (fn, fb) => { try { return await fn(); } catch (e) { if (absent(e)) return fb; throw e; } };

const COLS = `price_id, sku_code, product_id, channel_code, description, category, subcategory, brand,
  supplier, country, season, range, status, launch_date, discontinue_date, rmb_cost, discount_pct, fx_rate,
  sea_freight, air_freight, duty, insurance, port_charges, customs, other_import, goods_in, goods_out,
  warehouse_storage, warehouse_admin, handling, other_logistics, wholesale_margin_pct, distributor_margin_pct,
  retail_vat_pct, actual_retail_price, rrp, promotional_price, markdown_price, target_gp_pct, notes, source_tag,
  updated_by, updated_at`;

// Attach the computed pricing view + alerts to a raw row (with its commercial join).
function decorate(row) {
  const commercial = {
    unitsSold: row.units_ttm != null ? Number(row.units_ttm) : null,
    revenue: row.revenue_ttm != null ? Number(row.revenue_ttm) : null,
    cashInvested: row.stock_value != null ? Number(row.stock_value) : null,
    markdownPct: row.markdown_price && row.actual_retail_price ? Math.max(0, 1 - Number(row.markdown_price) / Number(row.actual_retail_price)) : null,
  };
  const view = priceSku(row, { markdownPct: commercial.markdownPct });
  const sellEx = view.margin.sellingExVat;
  const alerts = [];
  if (view.margin.gp < 0) alerts.push("NEGATIVE_MARGIN");
  if (view.margin.gpPct != null && row.target_gp_pct && view.margin.gpPct < Number(row.target_gp_pct)) alerts.push("BELOW_TARGET");
  if (Number(row.air_freight) > 0) alerts.push("AIR_FREIGHT_USED");
  if (view.freightBurden != null && view.freightBurden > 0.3) alerts.push("HIGH_FREIGHT");
  if (sellEx != null && sellEx < view.build.totalCost) alerts.push("PRICE_BELOW_COST");
  if (view.fxMarginSensitivity != null && view.fxMarginSensitivity > 0.05) alerts.push("FX_EXPOSURE");
  return { ...row, commercial, view, alerts };
}

export async function listSkuPrices({ channel = null, category = null, status = null, search = null, limit = 500 } = {}) {
  return safe(async () => {
    const { rows } = await query(
      `SELECT ${COLS}, m.units_ttm, m.revenue_ttm, m.stock_value, m.margin_pct AS actual_margin_pct
         FROM pricing.sku_price p
         LEFT JOIN commercial.sku_metric m ON m.sku = p.sku_code
        WHERE ($1::varchar IS NULL OR p.channel_code = $1)
          AND ($2::varchar IS NULL OR p.category = $2)
          AND ($3::varchar IS NULL OR p.status = $3)
          AND ($4::varchar IS NULL OR p.sku_code ILIKE '%'||$4||'%' OR p.description ILIKE '%'||$4||'%')
        ORDER BY p.category, p.sku_code
        LIMIT $5`,
      [channel, category, status, search, limit]);
    return rows.map(decorate);
  }, []);
}

export async function getSkuPrice(id) {
  return safe(async () => {
    const { rows } = await query(
      `SELECT ${COLS}, m.units_ttm, m.revenue_ttm, m.stock_value, m.margin_pct AS actual_margin_pct
         FROM pricing.sku_price p LEFT JOIN commercial.sku_metric m ON m.sku = p.sku_code
        WHERE p.price_id = $1`, [id]);
    return rows[0] ? decorate(rows[0]) : null;
  }, null);
}

const NUMERIC = ["rmb_cost", "discount_pct", "fx_rate", "sea_freight", "air_freight", "duty", "insurance",
  "port_charges", "customs", "other_import", "goods_in", "goods_out", "warehouse_storage", "warehouse_admin",
  "handling", "other_logistics", "wholesale_margin_pct", "distributor_margin_pct", "retail_vat_pct",
  "actual_retail_price", "rrp", "promotional_price", "markdown_price", "target_gp_pct"];
const TEXT = ["description", "category", "subcategory", "brand", "supplier", "country", "season", "range", "status", "notes"];

// Upsert one SKU price (on sku_code + channel_code). Used by the editor and upload.
export async function upsertSkuPrice(input, actor, sourceTag = "MANUAL") {
  if (!input.sku_code) throw new Error("SKU is required");
  if (!["MINISO_MDS", "LOCAL_PURCHASE"].includes(input.channel_code)) throw new Error("Choose a purchase channel");
  const cols = ["sku_code", "channel_code", "source_tag", "updated_by"];
  const vals = [input.sku_code, input.channel_code, sourceTag, actorOf(actor)];
  for (const k of TEXT) if (input[k] !== undefined) { cols.push(k); vals.push(input[k] || null); }
  for (const k of NUMERIC) if (input[k] !== undefined && input[k] !== "") { cols.push(k); vals.push(Number(input[k])); }
  for (const k of ["launch_date", "discontinue_date"]) if (input[k]) { cols.push(k); vals.push(input[k]); }
  const set = cols.filter((c) => !["sku_code", "channel_code"].includes(c)).map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await query(
    `INSERT INTO pricing.sku_price (${cols.join(", ")}, updated_at) VALUES (${ph}, CURRENT_TIMESTAMP)
     ON CONFLICT (sku_code, channel_code) DO UPDATE SET ${set}, updated_at = CURRENT_TIMESTAMP
     RETURNING price_id`, vals);
  await audit({ actor, eventType: "pricing.upsert", objectType: "sku_price", objectRef: input.sku_code, detail: { channel: input.channel_code } });
  return { ok: true, priceId: rows[0].price_id };
}

export async function deleteSkuPrice(id, actor) {
  await query(`DELETE FROM pricing.sku_price WHERE price_id = $1`, [id]);
  await audit({ actor, eventType: "pricing.delete", objectType: "sku_price", objectRef: String(id) });
  return { ok: true };
}

// Upload a SKU cost-build CSV — upserts every valid row.
export async function ingestPricingCsv(csvText, actor) {
  const { rows, errors } = parsePricingCsv(csvText);
  if (!rows.length) throw new Error(errors[0] || "No pricing rows found in the file");
  let n = 0;
  for (const r of rows) { await upsertSkuPrice(r, actor, "UPLOAD"); n++; }
  await audit({ actor, eventType: "pricing.ingest", objectType: "sku_price", objectRef: "upload", detail: { rows: n } });
  return { ok: true, rows: n, warnings: errors };
}

// Dashboard KPIs across the (optionally filtered) range.
export async function pricingDashboard({ channel = null } = {}) {
  const skus = await listSkuPrices({ channel, limit: 5000 });
  if (!skus.length) return { ready: false, count: 0 };
  let gpSum = 0, gpN = 0, markupSum = 0, markupN = 0, cash = 0, airFreight = 0, freightSum = 0, freightN = 0;
  let below = 0, above = 0, negative = 0, marginOpp = 0, fxExposed = 0;
  for (const s of skus) {
    const m = s.view.margin;
    if (m.gpPct != null) { gpSum += m.gpPct; gpN++; }
    if (m.markup != null) { markupSum += m.markup; markupN++; }
    if (s.view.freightBurden != null) { freightSum += s.view.freightBurden; freightN++; }
    airFreight += Number(s.air_freight) || 0;
    cash += s.commercial.cashInvested || 0;
    if (m.gp < 0) negative++;
    if (s.target_gp_pct && m.gpPct != null) {
      if (m.gpPct < Number(s.target_gp_pct)) { below++; marginOpp += Math.max(0, (Number(s.target_gp_pct) - m.gpPct) * m.sellingExVat) * (s.commercial.unitsSold || 1); }
      else above++;
    }
    if (s.alerts.includes("FX_EXPOSURE")) fxExposed++;
  }
  return {
    ready: true, count: skus.length,
    avgGpPct: gpN ? gpSum / gpN : null,
    avgMarkup: markupN ? markupSum / markupN : null,
    avgFreightBurden: freightN ? freightSum / freightN : null,
    cashInvested: Math.round(cash),
    airFreightCost: Math.round(airFreight),
    marginOpportunity: Math.round(marginOpp),
    skusBelowTarget: below, skusAboveTarget: above, negativeMargin: negative, fxExposed,
  };
}

export { healthBand };

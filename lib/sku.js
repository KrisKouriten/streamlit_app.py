import { query } from "./db";
import { audit } from "./governance";
import { pareto, newSkus, dormant, asOfMonth, parseSkuCsv } from "./sku-rules.js";

const tableMissing = (e) => e?.code === "42P01";

export async function getSkuAnalysis() {
  try {
    const { rows } = await query(
      `SELECT sku, description, category, launch_ym, last_sold_ym, units_ttm, revenue_ttm, margin_pct, stock_value, source_tag
       FROM commercial.sku_metric`
    );
    if (!rows.length) return { ready: true, loaded: false, illustrative: false };
    const asOf = asOfMonth(rows);
    const illustrative = rows.every((r) => r.source_tag === "ILLUSTRATIVE");
    return {
      ready: true, loaded: true, illustrative, asOf, count: rows.length,
      pareto: pareto(rows),
      newSkus: newSkus(rows, asOf),
      dormant: dormant(rows, asOf),
    };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false, illustrative: false };
    throw e;
  }
}

export async function ingestSkuCsv(csvText, actor) {
  const { records, errors } = parseSkuCsv(csvText);
  if (!records.length) {
    const reason = errors.length ? `${errors.length} row error(s): ${errors.slice(0, 3).map((e) => `row ${e.row} ${e.reason}`).join("; ")}` : "no valid rows";
    throw new Error(`SKUs not loaded — ${reason}`);
  }
  await query(`DELETE FROM commercial.sku_metric WHERE source_tag IN ('CSV upload','ILLUSTRATIVE')`);
  for (const r of records) {
    await query(
      `INSERT INTO commercial.sku_metric (sku, description, category, launch_ym, last_sold_ym, units_ttm, revenue_ttm, margin_pct, stock_value, source_tag)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CSV upload')
       ON CONFLICT (sku) DO UPDATE SET description=EXCLUDED.description, category=EXCLUDED.category,
         launch_ym=EXCLUDED.launch_ym, last_sold_ym=EXCLUDED.last_sold_ym, units_ttm=EXCLUDED.units_ttm,
         revenue_ttm=EXCLUDED.revenue_ttm, margin_pct=EXCLUDED.margin_pct, stock_value=EXCLUDED.stock_value,
         source_tag='CSV upload', updated_at=CURRENT_TIMESTAMP`,
      [r.sku, r.description, r.category, r.launch_ym, r.last_sold_ym, r.units_ttm, r.revenue_ttm, r.margin_pct, r.stock_value]
    );
  }
  await audit({ actor, eventType: "sku.upload", objectType: "sku_metric", objectRef: "csv", detail: { loaded: records.length, rowErrors: errors.length } });
  return { loaded: records.length, errors };
}

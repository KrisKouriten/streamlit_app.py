import { query } from "./db";
import { audit } from "./governance";
import { parseCsv } from "./intercompany-rules.js";

/*
 * Budget & Forecast plan model. Five datasets, each refreshed wholesale from a
 * CSV (clear then load). Queries feed the dashboard; ingest replaces a dataset.
 */

export const DATASETS = ["group_pl", "store", "store_month", "breakeven", "kpi"];
const n = (v) => { if (v == null || v === "") return null; const x = Number(String(v).replace(/[£$,%\s]/g, "")); return Number.isFinite(x) ? x : null; };
const norm = (h) => h.toLowerCase().trim();

// find a header whose normalized text matches any of the given needles (equals or startsWith)
function col(headers, ...needles) {
  const h = headers.map(norm);
  const i = h.findIndex((x) => needles.some((nd) => x === nd || x.startsWith(nd)));
  return i < 0 ? null : headers[i];
}

// ---------------------------------------------------------------- queries
export async function getGroupPL() {
  const { rows } = await query(`SELECT * FROM finance.plan_group_pl ORDER BY sort_order, id`);
  return rows;
}
export async function getStores() {
  const { rows } = await query(`SELECT * FROM finance.plan_store ORDER BY s2026 DESC NULLS LAST, id`);
  return rows;
}
export async function getBreakeven() {
  const { rows } = await query(`SELECT * FROM finance.plan_breakeven ORDER BY sort_order, id`);
  return rows;
}
export async function getKpi() {
  const { rows } = await query(`SELECT * FROM finance.plan_kpi ORDER BY sort_order, id`);
  return rows;
}
export async function getStoreMonths() {
  const { rows } = await query(`SELECT store_name, ym, ebitda FROM finance.plan_store_month ORDER BY store_name, ym`);
  const months = [...new Set(rows.map((r) => r.ym))].sort();
  const byStore = new Map();
  for (const r of rows) {
    if (!byStore.has(r.store_name)) byStore.set(r.store_name, {});
    byStore.get(r.store_name)[r.ym] = r.ebitda == null ? null : Number(r.ebitda);
  }
  const stores = [...byStore.entries()].map(([store, m]) => ({ store, months: m }));
  return { months, stores };
}

export async function planLoaded() {
  const { rows } = await query(`SELECT (SELECT count(*) FROM finance.plan_group_pl) AS g, (SELECT count(*) FROM finance.plan_store) AS s`);
  return Number(rows[0].g) > 0 || Number(rows[0].s) > 0;
}

// ---------------------------------------------------------------- ingest
export async function ingestDataset(dataset, csvText, actor) {
  if (!DATASETS.includes(dataset)) throw new Error("Unknown dataset");
  const { headers, records } = parseCsv(csvText);
  let count = 0;

  if (dataset === "group_pl" || dataset === "breakeven") {
    const lc = col(headers, "line", "metric", "£'000", "line_label");
    const c25 = col(headers, "2025a", "2025 a", "2025");
    const c26 = col(headers, "2026", "2026 a+f"), c27 = col(headers, "2027", "2027 b"), c28 = col(headers, "2028", "2028 b");
    const cb = col(headers, "beta");
    const table = dataset === "group_pl" ? "plan_group_pl" : "plan_breakeven";
    await query(`DELETE FROM finance.${table}`);
    let i = 0;
    for (const r of records) {
      const label = lc ? r[lc]?.trim() : "";
      if (!label) continue;
      if (dataset === "group_pl") {
        const ratio = /%/.test(label);
        await query(`INSERT INTO finance.plan_group_pl (line_label, sort_order, is_ratio, y2025a, y2026, y2027, y2028, beta)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [label, i, ratio, n(c25 && r[c25]), n(c26 && r[c26]), n(c27 && r[c27]), n(c28 && r[c28]), n(cb && r[cb])]);
      } else {
        await query(`INSERT INTO finance.plan_breakeven (line_label, sort_order, y2026, y2027, y2028)
          VALUES ($1,$2,$3,$4,$5)`, [label, i, n(c26 && r[c26]), n(c27 && r[c27]), n(c28 && r[c28])]);
      }
      i++; count++;
    }
  } else if (dataset === "kpi") {
    const lc = col(headers, "metric", "kpi", "£ / sq ft");
    const c26 = col(headers, "2026"), c27 = col(headers, "2027"), c28 = col(headers, "2028");
    await query(`DELETE FROM finance.plan_kpi`);
    let i = 0;
    for (const r of records) {
      const label = lc ? r[lc]?.trim() : "";
      if (!label) continue;
      await query(`INSERT INTO finance.plan_kpi (metric, sort_order, y2026, y2027, y2028) VALUES ($1,$2,$3,$4,$5)`,
        [label, i, n(c26 && r[c26]), n(c27 && r[c27]), n(c28 && r[c28])]);
      i++; count++;
    }
  } else if (dataset === "store") {
    const cs = col(headers, "store");
    const map = {
      s2025: col(headers, "sales 2025", "s2025", "2025"), s2026: col(headers, "sales 2026", "s2026", "2026"),
      s2027: col(headers, "sales 2027", "s2027", "2027"), s2028: col(headers, "sales 2028", "s2028", "2028"),
      beta: col(headers, "beta"), ebitda2028: col(headers, "ebitda 2028", "ebitda2028"),
      ebitda_mgn: col(headers, "ebitda margin", "ebitda mgn", "ebitda_mgn"), s2030: col(headers, "sales 2030", "s2030", "2030"),
      trajectory: col(headers, "trajectory"),
    };
    await query(`DELETE FROM finance.plan_store`);
    let i = 0;
    for (const r of records) {
      const store = cs ? r[cs]?.trim() : "";
      if (!store) continue;
      await query(`INSERT INTO finance.plan_store (store_name, sort_order, s2025, s2026, s2027, s2028, beta, ebitda2028, ebitda_mgn, s2030, trajectory)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [store, i, n(map.s2025 && r[map.s2025]), n(map.s2026 && r[map.s2026]), n(map.s2027 && r[map.s2027]), n(map.s2028 && r[map.s2028]),
         n(map.beta && r[map.beta]), n(map.ebitda2028 && r[map.ebitda2028]), n(map.ebitda_mgn && r[map.ebitda_mgn]), n(map.s2030 && r[map.s2030]),
         map.trajectory ? r[map.trajectory]?.trim() || null : null]);
      i++; count++;
    }
  } else if (dataset === "store_month") {
    const cs = col(headers, "store");
    const monthCols = headers.filter((h) => /^\d{4}-\d{2}$/.test(h.trim()));
    await query(`DELETE FROM finance.plan_store_month`);
    for (const r of records) {
      const store = cs ? r[cs]?.trim() : "";
      if (!store) continue;
      for (const mc of monthCols) {
        const v = n(r[mc]);
        await query(`INSERT INTO finance.plan_store_month (store_name, ym, ebitda) VALUES ($1,$2,$3)`, [store, mc.trim(), v]);
      }
      count++;
    }
  }
  await audit({ actor, eventType: "plan.upload", objectType: dataset, objectRef: dataset, detail: { count } });
  return { count };
}

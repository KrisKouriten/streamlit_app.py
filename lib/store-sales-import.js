import * as XLSX from "xlsx";
import { getPool, query } from "./db";
import { audit } from "./governance";
import { parseSalesRows, storeTradingWindows } from "./store-sales-import-rules.js";

/*
 * Store Sales & KPI feed — ingest the daily store workbook (the "Combined" sheet:
 * one row per store per day) into commercial.fact_store_sales, the table the
 * Store Sales & KPI dashboards read. Full-refresh per year: every ACTUAL store
 * row for a calendar year present in the file is cleared and reloaded, so a
 * re-upload is always safe and never leaves stale days behind. Stores are
 * upserted into core.dim_store; the canonical ACTUAL scenario (STORE-ACT, seeded
 * by migration 087) receives the rows. Parsing/shape logic is pure and unit
 * tested in lib/store-sales-import-rules.js.
 */

const SCENARIO_CODE = "STORE-ACT";
const columnMissing = (e) => e?.code === "42703";
const tableMissing = (e) => e?.code === "42P01";

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Calendar attributes for a dim_date row from an ISO date (Apr-start fiscal year).
function dateAttrs(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const y = d.getUTCFullYear(), m = d.getUTCMonth(); // 0-based month
  const fy = m >= 3 ? y : y - 1;
  const fMonth = ((m - 3 + 12) % 12) + 1;
  const weekStart = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
  return {
    date_key: Number(iso.replace(/-/g, "")),
    calendar_date: iso,
    day_name: dayNames[d.getUTCDay()],
    week_start_date: weekStart.toISOString().slice(0, 10),
    month_number: m + 1,
    month_name: monthNames[m],
    quarter_number: Math.floor(m / 3) + 1,
    calendar_year: y,
    fiscal_month: fMonth,
    fiscal_quarter: Math.floor((fMonth - 1) / 3) + 1,
    fiscal_year: fy,
    is_month_end: false,
    is_weekend: [0, 6].includes(d.getUTCDay()),
  };
}

// Find the sheet holding the daily rows: prefer one named "Combined", else the
// first sheet whose cells include a Store/Date/Net-sales header.
function pickSheet(wb) {
  const named = wb.SheetNames.find((n) => /combined/i.test(n));
  const order = named ? [named, ...wb.SheetNames] : wb.SheetNames;
  for (const name of order) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    const parsed = parseSalesRows(matrix);
    if (parsed.rows.length) return { name, parsed };
  }
  // Nothing parseable — return the named/first sheet's (empty) parse for its warnings.
  const ws = wb.Sheets[order[0]];
  return { name: order[0], parsed: parseSalesRows(XLSX.utils.sheet_to_json(ws || {}, { header: 1, raw: true, defval: null })) };
}

// Chunk an array into groups of n (keeps bulk INSERTs within parameter limits).
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function ingestStoreSalesWorkbook(buffer, actor) {
  let wb;
  try { wb = XLSX.read(buffer, { type: "buffer", cellDates: true }); }
  catch { throw new Error("Could not read the workbook — is it a valid .xlsx / .xlsb file?"); }

  const { name: sheetName, parsed } = pickSheet(wb);
  if (!parsed.rows.length) {
    throw new Error(parsed.warnings[0] || "No store-day rows found in the workbook.");
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Default entity for any newly-created store (Miniso UK group, else first).
    let { rows: ent } = await client.query(
      `SELECT entity_id FROM core.dim_entity ORDER BY (entity_type = 'GROUP') DESC, entity_id LIMIT 1`
    );
    if (!ent.length) {
      ent = (await client.query(
        `INSERT INTO core.dim_entity (entity_code, entity_name, entity_type, currency_code)
         VALUES ('MUK', 'Miniso UK', 'GROUP', 'GBP') RETURNING entity_id`
      )).rows;
    }
    const entityId = ent[0].entity_id;

    // 2. Canonical ACTUAL scenario the feed loads into.
    let { rows: sc } = await client.query(
      `SELECT scenario_id FROM core.dim_scenario WHERE scenario_code = $1`, [SCENARIO_CODE]
    );
    if (!sc.length) {
      sc = (await client.query(
        `INSERT INTO core.dim_scenario (scenario_code, scenario_name, scenario_type, status)
         VALUES ($1, 'Store Sales — Actual', 'ACTUAL', 'APPROVED') RETURNING scenario_id`, [SCENARIO_CODE]
      )).rows;
    }
    const scenarioId = sc[0].scenario_id;

    // 3. Ensure every date has a dim_date row.
    const isoDates = [...new Set(parsed.rows.map((r) => r.dateIso))];
    for (const grp of chunk(isoDates, 200)) {
      const vals = [];
      const ph = grp.map((iso, i) => {
        const a = dateAttrs(iso);
        const b = i * 13;
        vals.push(a.date_key, a.calendar_date, a.day_name, a.week_start_date, a.month_number, a.month_name,
          a.quarter_number, a.calendar_year, a.fiscal_month, a.fiscal_quarter, a.fiscal_year, a.is_month_end, a.is_weekend);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`;
      }).join(",");
      await client.query(
        `INSERT INTO core.dim_date
           (date_key, calendar_date, day_name, week_start_date, month_number, month_name,
            quarter_number, calendar_year, fiscal_month, fiscal_quarter, fiscal_year, is_month_end, is_weekend)
         VALUES ${ph} ON CONFLICT (date_key) DO NOTHING`, vals
      );
    }

    // 4. Upsert stores; keep is_established and the earliest first_trading_date.
    for (const w of storeTradingWindows(parsed.rows)) {
      await client.query(
        `INSERT INTO core.dim_store (store_code, store_name, entity_id, ownership_type, operator_name, first_trading_date, last_trading_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (store_code) DO UPDATE SET
           store_name = EXCLUDED.store_name,
           ownership_type = EXCLUDED.ownership_type,
           operator_name = EXCLUDED.operator_name,
           first_trading_date = LEAST(core.dim_store.first_trading_date, EXCLUDED.first_trading_date),
           last_trading_date = GREATEST(core.dim_store.last_trading_date, EXCLUDED.last_trading_date)`,
        [w.storeCode, w.storeName, entityId, w.ownershipType, w.operator, w.first, w.last]
      );
    }

    // 5. Full-refresh: clear ACTUAL store-sales for every calendar year in the file.
    for (const year of parsed.years) {
      await client.query(
        `DELETE FROM commercial.fact_store_sales
          WHERE scenario_id IN (SELECT scenario_id FROM core.dim_scenario WHERE scenario_type = 'ACTUAL')
            AND date_key BETWEEN $1 AND $2`,
        [year * 10000 + 101, year * 10000 + 1231]
      );
    }

    // 6. Map store_code → store_id, then bulk-insert the day rows.
    const { rows: storeRows } = await client.query(`SELECT store_id, store_code FROM core.dim_store`);
    const storeId = new Map(storeRows.map((s) => [s.store_code, s.store_id]));

    let inserted = 0;
    for (const grp of chunk(parsed.rows, 400)) {
      const vals = [];
      const ph = grp.map((r, i) => {
        const b = i * 13;
        vals.push(
          r.dateKey, storeId.get(r.storeCode), scenarioId,
          r.netSales, r.grossSales, r.grossProfit,
          r.unitsSold, Math.round(r.transactions) || 0, r.transactionsGross == null ? null : Math.round(r.transactionsGross),
          r.returnTransactions == null ? null : Math.round(r.returnTransactions),
          r.footfall == null ? null : Math.round(r.footfall), r.returnValue, r.isValidDay
        );
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`;
      }).join(",");
      await client.query(
        `INSERT INTO commercial.fact_store_sales
           (date_key, store_id, scenario_id, net_sales, gross_sales, gross_margin,
            units_sold, transactions, transactions_gross, return_transactions, footfall, return_value, is_valid_day)
         VALUES ${ph}`, vals
      );
      inserted += grp.length;
    }

    await client.query("COMMIT");

    await audit({
      actor, eventType: "STORE_SALES_UPLOAD", objectType: "fact_store_sales", objectRef: SCENARIO_CODE,
      detail: { rows: inserted, stores: parsed.stores.length, months: parsed.months, from: parsed.dateMin, to: parsed.dateMax, sheet: sheetName },
    }).catch(() => {});

    return {
      rows: inserted,
      stores: parsed.stores.length,
      months: parsed.months,
      from: parsed.dateMin,
      to: parsed.dateMax,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (tableMissing(e) || columnMissing(e)) {
      throw new Error("The store-sales tables aren't up to date — run migration 087_store_sales_feed.sql, then re-upload.");
    }
    throw e;
  } finally {
    client.release();
  }
}

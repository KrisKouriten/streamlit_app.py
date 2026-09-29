import * as XLSX from "xlsx";
import { query, getPool } from "./db";
import { audit } from "./governance";
import { dateAttrs, chunk } from "./store-sales-import";
import { dateKey } from "./store-sales-import-rules.js";
import {
  SALES_FC_PREFIX, parseSalesForecastWorkbook, matchStores, forecastStoreCode, storeKey, consolidateForecast,
  suggestStore, parseStoreLinks,
} from "./sales-forecast-rules.js";
import { getAppSetting, setAppSetting } from "./governance";
import { FRANCHISE_STORE_SALES_LINE } from "./forecast-rules.js";

/*
 * Sales forecast — DB layer (Plan – Finance → Sales Forecast).
 *
 * Each upload of the 4-year sales forecast becomes a VERSION: a FORECAST row in
 * core.dim_scenario (code SALES-FC-<n>) whose daily store sales sit in
 * commercial.fact_store_sales, the table the store dashboards already read.
 * Exactly one version is LIVE (status APPROVED). The live version is what the
 * dashboards, the home page and the Executive Intelligence Hub compare actuals
 * against, and what feeds company store sales into Forecast Builder's P&L.
 *
 * No migration: dim_scenario already carries version_number and a status, and
 * the fact table already takes a scenario per row.
 */

const LIVE = "APPROVED";
const absent = (e) => e?.code === "42P01" || e?.code === "3F000";

const channelOf = (ownership) => (ownership === "FRANCHISE" ? "FRANCHISE" : "COMPANY");

function sheetRows(wb, re) {
  const name = wb.SheetNames.find((n) => re.test(n));
  return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: null }) : null;
}

// The live version's scenario id, or null when none has been made live.
export async function liveSalesForecastId() {
  try {
    const { rows } = await query(
      `SELECT scenario_id FROM core.dim_scenario
        WHERE scenario_code LIKE $1 AND status = $2
        ORDER BY approved_at DESC NULLS LAST, version_number DESC LIMIT 1`, [`${SALES_FC_PREFIX}%`, LIVE]);
    return rows[0] ? Number(rows[0].scenario_id) : null;
  } catch (e) { if (absent(e)) return null; throw e; }
}

// Every version, newest first, with its totals by year and channel.
export async function listSalesForecastVersions() {
  try {
    const [{ rows: versions }, { rows: totals }] = await Promise.all([
      query(`SELECT scenario_id, scenario_code, scenario_name, version_number, status, created_at, approved_by, approved_at,
                    to_char(horizon_start,'YYYY-MM-DD') AS horizon_start, to_char(horizon_end,'YYYY-MM-DD') AS horizon_end
               FROM core.dim_scenario WHERE scenario_code LIKE $1 ORDER BY version_number DESC`, [`${SALES_FC_PREFIX}%`]),
      query(`SELECT s.scenario_id, d.calendar_year AS year, st.ownership_type, SUM(s.net_sales) AS net
               FROM commercial.fact_store_sales s
               JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
               JOIN core.dim_date d ON d.date_key = s.date_key
               JOIN core.dim_store st ON st.store_id = s.store_id
              WHERE sc.scenario_code LIKE $1
              GROUP BY s.scenario_id, d.calendar_year, st.ownership_type`, [`${SALES_FC_PREFIX}%`]),
    ]);
    const byVersion = {};
    for (const t of totals) {
      const y = String(t.year);
      const v = (byVersion[t.scenario_id] ||= {});
      const yr = (v[y] ||= { company: 0, franchise: 0, total: 0 });
      const n = Number(t.net) || 0;
      if (channelOf(t.ownership_type) === "COMPANY") yr.company += n; else yr.franchise += n;
      yr.total += n;
    }
    return {
      ready: true,
      versions: versions.map((v) => ({
        id: Number(v.scenario_id), code: v.scenario_code, label: v.scenario_name, version: v.version_number,
        live: v.status === LIVE, status: v.status, createdAt: v.created_at, madeLiveBy: v.approved_by, madeLiveAt: v.approved_at,
        from: v.horizon_start, to: v.horizon_end, years: byVersion[v.scenario_id] || {},
      })),
    };
  } catch (e) { if (absent(e)) return { ready: false, versions: [] }; throw e; }
}

// One version, store by store and month by month, consolidated.
export async function getSalesForecastVersion(id) {
  const { rows } = await query(
    `SELECT st.store_name AS store, st.ownership_type, to_char(d.calendar_date,'YYYY-MM') AS ym, SUM(s.net_sales) AS net
       FROM commercial.fact_store_sales s
       JOIN core.dim_date d ON d.date_key = s.date_key
       JOIN core.dim_store st ON st.store_id = s.store_id
      WHERE s.scenario_id = $1
      GROUP BY st.store_name, st.ownership_type, to_char(d.calendar_date,'YYYY-MM')`, [id]);
  return consolidateForecast(rows.map((r) => ({ store: r.store, channel: channelOf(r.ownership_type), ym: r.ym, net: Number(r.net) })));
}

/*
 * Upload a version. One transaction: nothing is half-loaded.
 *
 * Stores are matched to the store master by name (loosely — see storeKey).
 * A forecast store the master does not know yet — usually one not open yet —
 * is added, and named in the result so a spelling difference can be put right
 * rather than quietly becoming a second store.
 *
 * The first version ever uploaded goes live at once; later ones load as drafts
 * until someone makes them live, so a new version is checked before the
 * dashboards move to it.
 */
// The store master for matching, with what decides between duplicate names:
// is the row one the dashboards report, and has it traded? See matchStores.
const MASTER_SQL = `
  SELECT st.store_id, st.store_name, st.ownership_type,
         (st.operator_name IS NOT NULL AND st.ownership_type <> 'OTHER') AS reports,
         EXISTS (SELECT 1 FROM commercial.fact_store_sales s
                   JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
                  WHERE s.store_id = st.store_id AND sc.scenario_type = 'ACTUAL') AS has_actuals
    FROM core.dim_store st
   ORDER BY st.store_id`;

/*
 * Re-point a loaded version's daily figures at the right store rows.
 *
 * For each store in the version, the preferred row for its name (matchStores)
 * — reported, and trading — takes the figures if they sit on another row. A
 * version loaded before that preference existed can be repaired in place
 * rather than re-uploaded. Figures already on the right row are untouched.
 *   → { moved: [{ store, from, to }] }
 */
export async function rematchSalesForecast(id, actor) {
  const { rows: sc } = await query(`SELECT scenario_id, status FROM core.dim_scenario WHERE scenario_id = $1 AND scenario_code LIKE $2`, [id, `${SALES_FC_PREFIX}%`]);
  if (!sc.length) throw new Error("Version not found");
  const [{ rows: onRows }, { rows: master }] = await Promise.all([
    query(`SELECT DISTINCT st.store_id, st.store_name, st.ownership_type
             FROM commercial.fact_store_sales s JOIN core.dim_store st ON st.store_id = s.store_id
            WHERE s.scenario_id = $1`, [id]),
    query(MASTER_SQL),
  ]);
  const { matched } = matchStores(onRows.map((r) => ({ store: r.store_name, channel: channelOf(r.ownership_type) })), master, await getStoreLinks());
  const moved = [];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const r of onRows) {
      const to = matched.get(r.store_name);
      const from = Number(r.store_id);
      if (to == null || to === from) continue;
      await client.query(`UPDATE commercial.fact_store_sales SET store_id = $3 WHERE scenario_id = $1 AND store_id = $2`, [id, from, to]);
      moved.push({ store: r.store_name, from, to });
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
  if (moved.length && sc[0].status === LIVE) await syncForecastBuilder(Number(id));
  await audit({ actor, eventType: "sales_forecast.rematch", objectType: "dim_scenario", objectRef: String(id), detail: { moved } });
  return { ok: true, moved };
}

// Forecast names Finance have linked by hand to the store they trade as.
const LINKS_KEY = "sales_forecast_store_links";
export async function getStoreLinks() {
  return parseStoreLinks(await getAppSetting(LINKS_KEY, "{}").catch(() => "{}"));
}

/*
 * Link a forecast store to the store it trades as.
 *
 * Every sales forecast version's figures for the forecast store move onto the
 * trading store, and the link is saved so the next upload lands there first
 * time. A store record the forecast upload itself created (FC-…) that is left
 * with no figures is removed, so it does not linger in the store pickers.
 */
export async function linkForecastStore(fromStoreId, toStoreId, actor) {
  const from = Number(fromStoreId), to = Number(toStoreId);
  if (!from || !to || from === to) throw new Error("Pick the store it trades as");
  const { rows: st } = await query(`SELECT store_id, store_name, store_code FROM core.dim_store WHERE store_id = ANY($1)`, [[from, to]]);
  const fromRow = st.find((r) => Number(r.store_id) === from), toRow = st.find((r) => Number(r.store_id) === to);
  if (!fromRow || !toRow) throw new Error("Store not found");

  const { rowCount } = await query(
    `UPDATE commercial.fact_store_sales s SET store_id = $2
       FROM core.dim_scenario sc
      WHERE sc.scenario_id = s.scenario_id AND sc.scenario_code LIKE $3 AND s.store_id = $1`,
    [from, to, `${SALES_FC_PREFIX}%`]);

  const links = await getStoreLinks();
  links.set(storeKey(fromRow.store_name), to);
  await setAppSetting(LINKS_KEY, JSON.stringify(Object.fromEntries(links)), actor);

  // Tidy a store record the upload created, once nothing refers to it.
  if (String(fromRow.store_code || "").startsWith("FC-")) {
    const { rows: left } = await query(`SELECT 1 FROM commercial.fact_store_sales WHERE store_id = $1 LIMIT 1`, [from]);
    if (!left.length) await query(`DELETE FROM core.dim_store WHERE store_id = $1`, [from]).catch(() => {});
  }
  const live = await liveSalesForecastId().catch(() => null);
  if (live) await syncForecastBuilder(live);
  await audit({ actor, eventType: "sales_forecast.link_store", objectType: "dim_store", objectRef: String(to),
    detail: { forecastName: fromRow.store_name, from, to, tradingName: toRow.store_name, rows: rowCount } });
  return { ok: true, moved: rowCount, forecastName: fromRow.store_name, tradingName: toRow.store_name };
}

/*
 * Put a store on the dashboards: give a store record with no operator (or
 * marked Other) its ownership and operator, so its actual sales AND its
 * forecast are reported. For a store that trades but was never set up — a
 * newly acquired one, say. Only a record the dashboards currently leave out
 * can be changed here.
 */
export async function reportStore(storeId, { ownership = "COMPANY", operator = null, entityId = null } = {}, actor) {
  const own = ownership === "FRANCHISE" ? "FRANCHISE" : "COMPANY";
  const op = String(operator || "").trim().slice(0, 100) || (own === "COMPANY" ? "Miniso UK" : "");
  if (!op) throw new Error("Enter the franchise operator's name");
  // The legal entity the store trades under — an acquired store may sit in its
  // own company (e.g. ISSHO Birmingham Limited). Unchanged when not given.
  const ent = Number(entityId) || null;
  if (ent) {
    const { rows: e } = await query(`SELECT 1 FROM core.dim_entity WHERE entity_id = $1`, [ent]);
    if (!e.length) throw new Error("Entity not found");
  }
  const { rows } = await query(
    `UPDATE core.dim_store SET ownership_type = $2, operator_name = $3, entity_id = COALESCE($4, entity_id)
      WHERE store_id = $1 AND (operator_name IS NULL OR ownership_type = 'OTHER')
      RETURNING store_id, store_name`, [Number(storeId), own, op, ent]);
  if (!rows.length) throw new Error("That store is already reported on the dashboards");
  const live = await liveSalesForecastId().catch(() => null);
  if (live) await syncForecastBuilder(live);
  await audit({ actor, eventType: "sales_forecast.report_store", objectType: "dim_store", objectRef: String(storeId),
    detail: { store: rows[0].store_name, ownership: own, operator: op, entityId: ent } });
  return { ok: true, store: rows[0].store_name };
}

/*
 * Set up a store that has not traded yet — one the forecast expects to open.
 *
 * The forecast upload creates a bare store record for a store the master does
 * not know; this gives it what the dashboards and the entity reporting need:
 * company or franchise (and the franchise's operator), the legal entity it will
 * trade under — an existing one, or a new one created here — and the opening
 * date. Only a store with no actual sales can be set up this way, so a trading
 * store's record is never rewritten from this screen.
 */
const entityCodeFrom = (legal) =>
  `E-${String(legal || "").toUpperCase().replace(/\b(LIMITED|LTD|PLC)\b/g, "").replace(/[^A-Z0-9]+/g, "")}`.slice(0, 26) || "E-NEW";

export async function setupStore(storeId, { ownership = "COMPANY", operator = null, entityId = null, newEntityName = null, openingDate = null } = {}, actor) {
  const id = Number(storeId);
  const own = ownership === "FRANCHISE" ? "FRANCHISE" : "COMPANY";
  const op = String(operator || "").trim().slice(0, 120) || (own === "COMPANY" ? "Miniso UK" : "");
  if (!op) throw new Error("Enter the franchise operator's name");
  const opening = openingDate && /^\d{4}-\d{2}-\d{2}$/.test(String(openingDate)) ? String(openingDate) : null;

  const { rows: st } = await query(
    `SELECT st.store_id, st.store_name,
            EXISTS (SELECT 1 FROM commercial.fact_store_sales s JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
                     WHERE s.store_id = st.store_id AND sc.scenario_type = 'ACTUAL') AS has_actuals
       FROM core.dim_store st WHERE st.store_id = $1`, [id]);
  if (!st.length) throw new Error("Store not found");
  if (st[0].has_actuals) throw new Error(`${st[0].store_name} already has sales — its record is kept as the sales feed set it up`);

  const client = await getPool().connect();
  let ent = Number(entityId) || null, createdEntity = null;
  try {
    await client.query("BEGIN");
    const legal = String(newEntityName || "").trim().slice(0, 150);
    if (legal) {
      const { rows: found } = await client.query(
        `SELECT entity_id FROM core.dim_entity WHERE lower(COALESCE(legal_name, entity_name)) = lower($1) LIMIT 1`, [legal]).catch(() => ({ rows: [] }));
      if (found.length) ent = Number(found[0].entity_id);
      else {
        const base = entityCodeFrom(legal);
        const { rows: taken } = await client.query(`SELECT entity_code FROM core.dim_entity WHERE entity_code LIKE $1`, [`${base}%`]);
        const used = new Set(taken.map((r) => r.entity_code));
        let code = base, n = 2;
        while (used.has(code)) code = `${base.slice(0, 26)}-${n++}`;
        const { rows: ins } = await client.query(
          `INSERT INTO core.dim_entity (entity_code, entity_name, legal_name, entity_type, currency_code, is_active, valid_from)
           VALUES ($1, $2, $2, 'STORE', 'GBP', true, COALESCE($3::date, CURRENT_DATE)) RETURNING entity_id`, [code, legal, opening]);
        ent = Number(ins[0].entity_id);
        createdEntity = { code, name: legal };
      }
    }
    if (ent) {
      const { rows: e } = await client.query(`SELECT 1 FROM core.dim_entity WHERE entity_id = $1`, [ent]);
      if (!e.length) throw new Error("Entity not found");
    }
    await client.query(
      `UPDATE core.dim_store SET ownership_type = $2, operator_name = $3, entity_id = COALESCE($4, entity_id), opening_date = COALESCE($5::date, opening_date)
        WHERE store_id = $1`, [id, own, op, ent, opening]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }

  const live = await liveSalesForecastId().catch(() => null);
  if (live) await syncForecastBuilder(live);
  await audit({ actor, eventType: "sales_forecast.setup_store", objectType: "dim_store", objectRef: String(id),
    detail: { store: st[0].store_name, ownership: own, operator: op, entityId: ent, createdEntity, openingDate: opening } });
  return { ok: true, store: st[0].store_name, createdEntity };
}

/*
 * How a version's stores line up with the trading stores this year: the ones
 * the dashboards cannot read (no operator, or OTHER), and the ones with no
 * actual sales yet — not open, or trading under another name.
 */
export async function storeMatchCheck(id, year = new Date().getFullYear()) {
  const { rows } = await query(
    `SELECT st.store_id, st.store_name, st.store_code, st.ownership_type, st.entity_id, st.operator_name,
            to_char(st.opening_date, 'YYYY-MM-DD') AS opening_date,
            (st.operator_name IS NOT NULL AND st.ownership_type <> 'OTHER') AS reports,
            SUM(s.net_sales) AS fc_year,
            EXISTS (SELECT 1 FROM commercial.fact_store_sales a
                      JOIN core.dim_scenario asc2 ON asc2.scenario_id = a.scenario_id
                     WHERE a.store_id = st.store_id AND asc2.scenario_type = 'ACTUAL'
                       AND a.date_key BETWEEN $2 AND $3) AS traded,
            (SELECT COALESCE(SUM(a.net_sales),0) FROM commercial.fact_store_sales a
                      JOIN core.dim_scenario asc3 ON asc3.scenario_id = a.scenario_id
                     WHERE a.store_id = st.store_id AND asc3.scenario_type = 'ACTUAL'
                       AND a.date_key BETWEEN $2 AND $3) AS actual_year
       FROM commercial.fact_store_sales s
       JOIN core.dim_store st ON st.store_id = s.store_id
      WHERE s.scenario_id = $1 AND s.date_key BETWEEN $2 AND $3
      GROUP BY st.store_id, st.store_name, st.store_code, st.ownership_type, st.operator_name, st.entity_id, st.opening_date`,
    [id, Number(year) * 10000 + 101, Number(year) * 10000 + 1231]);
  const list = rows.map((r) => ({ ...r, fc_year: Number(r.fc_year) || 0, actual_year: Number(r.actual_year) || 0 }));
  // The stores a forecast name could be linked to: reported stores that have
  // traded this year. Those with no forecast of their own in this version are
  // the likely matches, and come first.
  const { rows: trading } = await query(
    `SELECT st.store_id, st.store_name, st.ownership_type, SUM(s.net_sales) AS actual
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
      WHERE sc.scenario_type = 'ACTUAL' AND st.operator_name IS NOT NULL AND st.ownership_type <> 'OTHER'
        AND s.date_key BETWEEN $1 AND $2
      GROUP BY st.store_id, st.store_name, st.ownership_type`,
    [Number(year) * 10000 + 101, Number(year) * 10000 + 1231]);
  const forecastIds = new Set(list.map((r) => Number(r.store_id)));
  const candidates = trading
    .map((t) => ({ store_id: Number(t.store_id), store_name: t.store_name, ownership_type: t.ownership_type, actual: Number(t.actual) || 0, hasForecast: forecastIds.has(Number(t.store_id)) }))
    .sort((a, b) => (a.hasForecast === b.hasForecast ? a.store_name.localeCompare(b.store_name) : a.hasForecast ? 1 : -1));
  const open = candidates.filter((c) => !c.hasForecast);
  const withSuggestion = (r) => ({ ...r, suggested: suggestStore(r.store_name, open) });
  return {
    year,
    notReported: list.filter((r) => !r.reports).sort((a, b) => b.fc_year - a.fc_year).map(withSuggestion),
    noActuals: list.filter((r) => r.reports && !r.traded).sort((a, b) => b.fc_year - a.fc_year).map(withSuggestion),
    notReportedValue: list.filter((r) => !r.reports).reduce((t, r) => t + r.fc_year, 0),
    candidates,
    entities: await query(
      `SELECT entity_id, entity_name, legal_name FROM core.dim_entity
        WHERE COALESCE(is_active, true) ORDER BY COALESCE(legal_name, entity_name)`)
      .then((r) => r.rows.map((e) => ({ entity_id: Number(e.entity_id), name: e.legal_name || e.entity_name })))
      .catch(() => []),
  };
}

export async function uploadSalesForecast(buffer, { filename = "", label = "" } = {}, actor) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const monthly = sheetRows(wb, /monthly\s*by\s*store/i);
  const daily = sheetRows(wb, /daily\s*sales/i);
  if (!monthly || !daily) {
    throw new Error("That isn't the 4-year sales forecast — it needs a 'Monthly by Store' tab and a 'Daily Sales' tab. Nothing was loaded.");
  }
  const parsed = parseSalesForecastWorkbook({ monthly, daily });
  if (parsed.errors.length) throw new Error(`Sales forecast not loaded — ${parsed.errors.slice(0, 3).join("; ")}`);

  const names = [
    ...parsed.stores.company.map((store) => ({ store, channel: "COMPANY" })),
    ...parsed.stores.franchise.map((store) => ({ store, channel: "FRANCHISE" })),
  ];
  const dates = [...new Set(parsed.days.map((d) => d.dateIso))].sort();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    // Stores — match, then add any the master does not know.
    const { rows: master } = await client.query(MASTER_SQL);
    const { matched, missing } = matchStores(names, master, await getStoreLinks());
    const ownershipDiffers = [];
    for (const n of names) {
      const id = matched.get(n.store);
      if (id == null) continue;
      const m = master.find((s) => Number(s.store_id) === id);
      if (m && channelOf(m.ownership_type) !== n.channel) ownershipDiffers.push(`${n.store} (${n.channel.toLowerCase()} in the forecast, ${String(m.ownership_type).toLowerCase()} in the store list)`);
    }
    if (missing.length) {
      let { rows: ent } = await client.query(`SELECT entity_id FROM core.dim_entity ORDER BY (entity_type = 'GROUP') DESC, entity_id LIMIT 1`);
      if (!ent.length) throw new Error("No entity to attach new stores to — load the store sales feed first.");
      for (const n of missing) {
        const { rows } = await client.query(
          `INSERT INTO core.dim_store (store_code, store_name, entity_id, ownership_type, operator_name, status)
           VALUES ($1,$2,$3,$4,$5,'ACTIVE')
           ON CONFLICT (store_code) DO UPDATE SET store_name = EXCLUDED.store_name
           RETURNING store_id`,
          [forecastStoreCode(n.store), n.store, ent[0].entity_id, n.channel, n.channel === "COMPANY" ? "Miniso UK" : "Franchise partner"]);
        matched.set(n.store, Number(rows[0].store_id));
      }
    }

    // Every date needs a calendar row.
    for (const grp of chunk(dates, 200)) {
      const vals = [];
      const ph = grp.map((iso, i) => {
        const a = dateAttrs(iso);
        const b = i * 13;
        vals.push(a.date_key, a.calendar_date, a.day_name, a.week_start_date, a.month_number, a.month_name,
          a.quarter_number, a.calendar_year, a.fiscal_month, a.fiscal_quarter, a.fiscal_year, a.is_month_end, a.is_weekend);
        return `(${Array.from({ length: 13 }, (_, j) => `$${b + j + 1}`).join(",")})`;
      }).join(",");
      await client.query(
        `INSERT INTO core.dim_date (date_key, calendar_date, day_name, week_start_date, month_number, month_name,
           quarter_number, calendar_year, fiscal_month, fiscal_quarter, fiscal_year, is_month_end, is_weekend)
         VALUES ${ph} ON CONFLICT (date_key) DO NOTHING`, vals);
    }

    // The version.
    const { rows: nx } = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM core.dim_scenario WHERE scenario_code LIKE $1`, [`${SALES_FC_PREFIX}%`]);
    const n = Number(nx[0].n);
    const { rows: anyLive } = await client.query(
      `SELECT 1 FROM core.dim_scenario WHERE scenario_code LIKE $1 AND status = $2 LIMIT 1`, [`${SALES_FC_PREFIX}%`, LIVE]);
    const goLive = !anyLive.length;
    const who = actor?.email || actor?.name || String(actor || "") || null;
    const { rows: sc } = await client.query(
      `INSERT INTO core.dim_scenario (scenario_code, scenario_name, scenario_type, version_number, horizon_start, horizon_end, status, approved_by, approved_at)
       VALUES ($1,$2,'FORECAST',$3,$4,$5,$6,$7,$8) RETURNING scenario_id`,
      [`${SALES_FC_PREFIX}${n}`, (label || filename || `Sales forecast v${n}`).slice(0, 100), n, dates[0], dates[dates.length - 1],
       goLive ? LIVE : "DRAFT", goLive ? who : null, goLive ? new Date() : null]);
    const scenarioId = Number(sc[0].scenario_id);

    // The daily figures, in batches.
    for (const grp of chunk(parsed.days, 10000)) {
      await client.query(
        `INSERT INTO commercial.fact_store_sales (date_key, store_id, scenario_id, net_sales)
         SELECT * FROM unnest($1::int[], $2::bigint[], $3::bigint[], $4::numeric[])`,
        [grp.map((d) => dateKey(d.dateIso)), grp.map((d) => matched.get(d.store)), grp.map(() => scenarioId), grp.map((d) => d.net)]);
    }

    await client.query("COMMIT");
    if (goLive) await syncForecastBuilder(scenarioId);
    await audit({ actor, eventType: "sales_forecast.upload", objectType: "dim_scenario", objectRef: String(scenarioId),
      detail: { version: n, label, filename, days: parsed.days.length, stores: names.length, newStores: missing.map((m) => m.store), live: goLive, years: parsed.years } });
    return {
      ok: true, id: scenarioId, version: n, label: label || filename, live: goLive,
      days: parsed.days.length, companyStores: parsed.stores.company.length, franchiseStores: parsed.stores.franchise.length,
      years: parsed.years, newStores: missing.map((m) => m.store), ownershipDiffers,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Make a version the live one. The previous live version is kept, superseded.
export async function setLiveSalesForecast(id, actor) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT scenario_id FROM core.dim_scenario WHERE scenario_id = $1 AND scenario_code LIKE $2`, [id, `${SALES_FC_PREFIX}%`]);
    if (!rows.length) throw new Error("Version not found");
    await client.query(`UPDATE core.dim_scenario SET status = 'SUPERSEDED' WHERE scenario_code LIKE $1 AND status = $2 AND scenario_id <> $3`, [`${SALES_FC_PREFIX}%`, LIVE, id]);
    await client.query(`UPDATE core.dim_scenario SET status = $2, approved_by = $3, approved_at = CURRENT_TIMESTAMP WHERE scenario_id = $1`,
      [id, LIVE, actor?.email || actor?.name || null]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
  await syncForecastBuilder(id);
  await audit({ actor, eventType: "sales_forecast.live", objectType: "dim_scenario", objectRef: String(id) });
  return { ok: true };
}

// Delete a version that is not live, with its daily figures.
export async function deleteSalesForecast(id, actor) {
  const { rows } = await query(`SELECT status, scenario_name FROM core.dim_scenario WHERE scenario_id = $1 AND scenario_code LIKE $2`, [id, `${SALES_FC_PREFIX}%`]);
  if (!rows.length) throw new Error("Version not found");
  if (rows[0].status === LIVE) throw new Error("This is the live forecast — make another version live before deleting it");
  await query(`DELETE FROM commercial.fact_store_sales WHERE scenario_id = $1`, [id]);
  await query(`DELETE FROM core.dim_scenario WHERE scenario_id = $1`, [id]);
  await audit({ actor, eventType: "sales_forecast.delete", objectType: "dim_scenario", objectRef: String(id), detail: { label: rows[0].scenario_name } });
  return { ok: true };
}

/*
 * Forecast Builder's company store sales come from the live version.
 *
 * Forecast Builder is the P&L: it needs each company store's sales to drive
 * that store's variable costs, so those are written to its "ST: Sales" lines
 * for the months the version covers. Franchise store sales are NOT P&L
 * revenue — the franchise earns us allocation and royalty, not its sales — so
 * any franchise store-sales lines from the earlier upload are removed.
 *
 * A store is written under the name Forecast Builder already uses for it, where
 * the loose name match finds one, so its costs keep applying to it.
 */
export async function syncForecastBuilder(scenarioId) {
  const { rows } = await query(
    `SELECT st.store_name AS store, to_char(d.calendar_date,'YYYY-MM') AS ym, SUM(s.net_sales) AS net
       FROM commercial.fact_store_sales s
       JOIN core.dim_date d ON d.date_key = s.date_key
       JOIN core.dim_store st ON st.store_id = s.store_id
      WHERE s.scenario_id = $1 AND st.ownership_type <> 'FRANCHISE'
      GROUP BY st.store_name, to_char(d.calendar_date,'YYYY-MM')`, [scenarioId]);
  if (!rows.length) return { synced: 0 };
  let units = [];
  try { units = (await query(`SELECT DISTINCT unit FROM finance.forecast_line WHERE scope = 'STORES' AND unit IS NOT NULL`)).rows.map((r) => r.unit); }
  catch (e) { if (absent(e)) return { synced: 0 }; throw e; }
  const unitByKey = new Map(units.map((u) => [storeKey(u), u]));
  const recs = rows.map((r) => ({ unit: unitByKey.get(storeKey(r.store)) || r.store, ym: r.ym, value: Number(r.net) || 0 })).filter((r) => r.value);
  const yms = [...new Set(recs.map((r) => r.ym))];

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM finance.forecast_line WHERE scope = 'STORES' AND line_label = 'ST: Sales' AND cost_type = 'SALES' AND ym = ANY($1)`, [yms]);
    await client.query(`DELETE FROM finance.forecast_line WHERE scope = 'FRANCHISE' AND line_label = $1`, [FRANCHISE_STORE_SALES_LINE]);
    for (const grp of chunk(recs, 1000)) {
      await client.query(
        `INSERT INTO finance.forecast_line (scope, unit, line_label, cost_type, ym, value, source, updated_by)
         SELECT 'STORES', u, 'ST: Sales', 'SALES', m, v, 'Sales forecast (live)', 'sales-forecast'
           FROM unnest($1::varchar[], $2::varchar[], $3::numeric[]) AS t(u, m, v)
         ON CONFLICT (scope, COALESCE(unit,''), line_label, cost_type, COALESCE(ym,''))
         DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, updated_at = CURRENT_TIMESTAMP`,
        [grp.map((r) => r.unit), grp.map((r) => r.ym), grp.map((r) => r.value)]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
  return { synced: recs.length, months: yms.length };
}


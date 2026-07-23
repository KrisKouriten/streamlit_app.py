import { query } from "./db";
import { getForecast } from "./forecast.js";
import { buildTabs, TAB_ORDER } from "./ma-tabs-rules.js";

/*
 * Management Accounts Dashboard analysis tabs — DB layer. Fetches the per-entity
 * actuals (finance.joiin_pl_entity) and the forecast lines (finance.forecast_line
 * via getForecast), then hands both to the pure buildTabs.
 */
export { TAB_ORDER };
const tableMissing = (e) => e?.code === "42P01";

export async function getMaTabs({ period = "ytd", year = null } = {}) {
  let rows;
  try {
    ({ rows } = await query(`SELECT entity_id, entity_name, section, account, ym, value FROM finance.joiin_pl_entity`));
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false };
    throw e;
  }
  if (!rows.length) return { ready: true, loaded: false };

  const fc = await getForecast();
  const forecastLines = fc.loaded ? fc.lines : [];
  const { meta, tabs } = buildTabs(rows, forecastLines, { period, year });
  return { ready: true, loaded: true, ...meta, tabs };
}

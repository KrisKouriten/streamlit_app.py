import { getBoardPack } from "./joiin-boardpack.js";
import { getForecast } from "./forecast.js";
import { computeForecast } from "./forecast-rules.js";
import { SCOPE_MAP, assembleDashboard } from "./ma-dashboard-rules.js";

/*
 * Management Accounts dashboard — DB layer. Actuals from the PERFORM board packs
 * (finance.joiin_boardpack); forecast from the PLAN Forecast Builder
 * (finance.forecast_line → computeForecast). The comparison itself lives in the
 * pure ma-dashboard-rules.js (assembleDashboard); this only fetches.
 */

export { SCOPE_MAP };

// period: "current" | "ytd". year: "YYYY" (defaults to the latest with actuals).
export async function getMaDashboard({ period = "current", year = null } = {}) {
  const fc = await getForecast();
  const forecast = fc.loaded ? computeForecast(fc.lines) : null;

  const packs = {};
  for (const def of SCOPE_MAP) packs[def.scope] = await getBoardPack(def.scope, year);

  const anyReady = SCOPE_MAP.some((d) => packs[d.scope]?.ready);
  const anyLoaded = SCOPE_MAP.some((d) => packs[d.scope]?.loaded);
  if (!anyReady) return { ready: false, loaded: false };
  if (!anyLoaded) return { ready: true, loaded: false, forecastLoaded: fc.loaded };

  const built = assembleDashboard(packs, forecast, period, year);
  return { ready: true, loaded: true, forecastLoaded: fc.loaded, ...built };
}

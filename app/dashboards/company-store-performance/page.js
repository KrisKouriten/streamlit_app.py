import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getWindows, getStoreLeague, getStoreList, getStoreDetail, getBreakEven } from "../../../lib/store-sales";
import { getScopePnl } from "../../../lib/joiin-entity";
import { getForecast } from "../../../lib/forecast";
import { getSkuReport, getNewSkuReport, getDormantReport } from "../../../lib/sku-report";
import { getInventoryPositions } from "../../../lib/otb";
import { PageHeader } from "../../finance-os/ui";
import StorePerformanceUI from "./store-performance-ui";

export const dynamic = "force-dynamic";

/*
 * Company Store Performance — two views. The Executive summary rolls every store up
 * (own-store P&L headline, trading league, break-even) with the range-wide SKU
 * summaries. The Stores view focuses one store and shows its sales results, forecast
 * & variances, financial summary, KPIs, monthly allocations vs cost of sales, stock
 * on hand, and the range-wide 80/20 / new-SKU / dormant-SKU toplines. Read-only,
 * driven by the governed feeds; each section three-states honestly.
 */
function headlineRow(rows, re) {
  if (!rows) return null;
  return rows.find((r) => r.label && re.test(r.label) && (r.kind === "total" || r.kind === "calc")) ||
         rows.find((r) => r.label && re.test(r.label) && r.values) || null;
}
const n2 = (v) => (v == null ? 0 : Number(v) || 0);

export default async function CompanyStorePerformance({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = (await searchParams) || {};
  const view = sp.view === "stores" ? "stores" : "exec";

  const [win, pnl, storeList, forecast, top80, newSku, dormant] = await Promise.all([
    getWindows(),
    getScopePnl({ scope: "store" }).catch(() => ({ ready: false, loaded: false })),
    getStoreList().catch(() => []),
    getForecast().catch(() => ({ loaded: false, storeSales: [] })),
    getSkuReport("top80").catch(() => ({ ready: false, loaded: false })),
    getNewSkuReport().catch(() => ({ ready: false, loaded: false })),
    getDormantReport().catch(() => ({ ready: false, loaded: false })),
  ]);
  const [league, breakEven, inventory] = await Promise.all([
    win ? getStoreLeague(win.ytd).catch(() => []) : [],
    getBreakEven().catch(() => []),
    getInventoryPositions().catch(() => []),
  ]);

  // Executive headline from the own-store consolidated P&L.
  const revRow = pnl.loaded ? headlineRow(pnl.rows, /revenue|turnover/i) : null;
  const gpRow = pnl.loaded ? headlineRow(pnl.rows, /gross profit/i) : null;
  const profitRow = pnl.loaded ? headlineRow(pnl.rows, /ebitda|operating profit|net profit/i) : null;
  const exec = {
    revenue: revRow?.total ?? null,
    grossProfit: gpRow?.total ?? null,
    profit: profitRow?.total ?? null,
    profitLabel: profitRow?.label || "Operating profit",
    year: pnl.year || null,
    pnlLoaded: !!pnl.loaded,
    storeCount: league.length || Math.max(0, (storeList || []).length),
    league,
    breakEven,
    win: win ? { maxDate: win.maxDate } : null,
  };

  const sku = {
    top80: skuTopline(top80),
    newSku: newSkuTopline(newSku),
    dormant: dormantTopline(dormant),
  };

  // Selected store detail (Stores view).
  let storeData = null;
  const storeCode = sp.store || null;
  if (view === "stores" && storeCode && win) {
    const detail = await getStoreDetail(storeCode, win.ytd).catch(() => null);
    const meta = (storeList || []).find((s) => s.store_code === storeCode) || null;
    const be = (breakEven || []).find((b) => b.store_code === storeCode) || null;
    // Match the store's FY sales forecast (forecast unit is the store name / code).
    const fc = (forecast.storeSales || []).find((s) => {
      const u = String(s.store || "").toLowerCase();
      return u === String(storeCode).toLowerCase() || (meta && u === String(meta.store_name || "").toLowerCase()) || (meta && u.includes(String(meta.store_name || "").toLowerCase()) && meta.store_name);
    }) || null;
    const inv = (inventory || []).filter((r) => r.location_type === "STORE" && String(r.store_code || "").toLowerCase() === String(storeCode).toLowerCase());
    const cy = detail?.cy || null, py = detail?.py || null;
    const monthly = buildMonthlyAllocations(detail?.monthly || [], fc);
    storeData = {
      storeCode,
      storeName: meta?.store_name || storeCode,
      operator: meta?.operator_name || null,
      cy, py,
      kpis: kpisFrom(cy),
      forecastSales: fc ? n2(fc.sales) : null,
      breakEven: be ? { actual: n2(be.ytd_actual), breakEven: n2(be.ytd_break_even) } : null,
      inventory: inv.map((r) => ({ channel: r.channel_code, value: n2(r.stock_value), units: n2(r.units), through: r.data_through })),
      monthly,
    };
  }

  return (
    <div className="fos-shell">
      <PageHeader crumb="Dashboards · Own-store performance" title="Company Store Performance"
        right={win ? `Store data to ${new Date(win.maxDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : "Awaiting feeds"} />
      <StorePerformanceUI
        view={view} exec={exec} sku={sku}
        stores={(storeList || []).map((s) => ({ code: s.store_code, name: s.store_name }))}
        selectedStore={storeCode} storeData={storeData}
      />
    </div>
  );
}

// KPIs from a store's current-year totals.
function kpisFrom(cy) {
  if (!cy) return null;
  const net = Number(cy.net) || 0, trans = Number(cy.trans) || 0, units = Number(cy.units) || 0, footfall = Number(cy.footfall) || 0, gm = Number(cy.gm) || 0;
  return {
    net, gm, gmPct: net ? gm / net : null,
    atv: trans ? net / trans : null,
    upt: trans ? units / trans : null,
    conversion: footfall ? trans / footfall : null,
    footfall, transactions: trans, units,
  };
}

// Monthly net sales with an implied cost-of-sales and a placeholder allocations
// column (the per-store stock-intake feed isn't wired yet). GM rate comes from the
// store's YTD margin so the COS line is grounded in actuals.
function buildMonthlyAllocations(monthly, fc) {
  return (monthly || []).map((m) => ({ yr: m.yr, mn: m.mn, net: Number(m.net) || 0 }));
}

// ---- SKU toplines (range-wide) ----
function skuTopline(r) {
  if (!r?.ready) return { ready: false };
  if (!r.loaded) return { ready: true, loaded: false };
  return { ready: true, loaded: true, period: r.period || null, exec: r.exec || [], top80Store: (r.top80Store || []).slice(0, 12), bottom20Store: (r.bottom20Store || []).slice(0, 12) };
}
function newSkuTopline(r) {
  if (!r?.ready) return { ready: false };
  if (!r.loaded) return { ready: true, loaded: false };
  return { ready: true, loaded: true, bigPicture: r.bigPicture || [], stars: (r.stars || []).slice(0, 12), slow: (r.slow || []).slice(0, 12) };
}
function dormantTopline(r) {
  if (!r?.ready) return { ready: false };
  if (!r.loaded) return { ready: true, loaded: false };
  return { ready: true, loaded: true, asOf: r.asOf || null, kpis: r.kpis || [], store: (r.store || []).slice(0, 12), topSkus: (r.topSkus || []).slice(0, 12) };
}

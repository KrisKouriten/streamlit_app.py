import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listSalesForecastVersions, getSalesForecastVersion } from "../../../lib/sales-forecast";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import SalesForecastUI from "./sales-forecast-ui";

export const dynamic = "force-dynamic";

/*
 * Plan – Finance → Sales Forecast. Upload the 4-year sales forecast (company and
 * franchise stores), keep every version, and choose the live one. The live
 * version drives the store dashboards, the home page and the Executive
 * Intelligence Hub, and feeds company store sales into Forecast Builder.
 * Here: each version consolidated by month and by year, store by store, and
 * compared with another.
 */
export default async function SalesForecast({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");
  const sp = (await searchParams) || {};

  const list = await listSalesForecastVersions().catch(() => ({ ready: false, versions: [] }));
  const live = list.versions.find((v) => v.live) || null;
  const requested = Number(sp.v) || null;
  const shown = list.versions.find((v) => v.id === requested) || live || list.versions[0] || null;
  const detail = shown ? await getSalesForecastVersion(shown.id).catch(() => null) : null;

  return (
    <div className="fos-shell">
      <PageHeader crumb="Plan — Finance" title="Sales Forecast"
        right={live ? `Live: ${live.label}` : "No live forecast yet"} />
      {!list.ready ? (
        <EmptyState title="Store sales tables not found">
          The sales forecast loads into the store sales tables. Load the daily store sales feed once (Data Uploads), then upload the forecast here.
        </EmptyState>
      ) : (
        <SalesForecastUI versions={list.versions} shownId={shown?.id || null} detail={detail} canManage={canManage} />
      )}
    </div>
  );
}

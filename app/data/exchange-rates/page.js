import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getFxRates } from "../../../lib/fx";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import ExchangeRatesUI from "./exchange-rates-ui";

export const dynamic = "force-dynamic";

/*
 * Exchange Rates (FINANCE DATA) — the USD→GBP rates Finance converts procurement
 * at. Three rate types: SPOT (paid at the point in time), HEDGED (locked in with
 * HSBC), COSTING (the rate stock is valued at). Editable by Finance; read-only
 * for everyone else. The same rates drive the currency conversion on the
 * Procurement Requests approval step.
 */
export default async function ExchangeRates() {
  const session = await getSession();
  if (!session) redirect("/login");
  const isFinance = hasRole(session, "ADMIN", "FINANCE");
  const rates = await getFxRates().catch(() => []);

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Finance Data" title="Exchange Rates"
        right="USD → GBP spot / hedged / costing rates" />
      {!rates.length ? (
        <EmptyState title="One migration to run">
          This screen needs the FX rate table (migration <span style={{ fontFamily: "var(--mono)" }}>085_fx_rates.sql</span>, idempotent). Apply it, refresh, and the USD rates will appear here.
        </EmptyState>
      ) : (
        <ExchangeRatesUI rates={rates} isFinance={isFinance} />
      )}
    </div>
  );
}

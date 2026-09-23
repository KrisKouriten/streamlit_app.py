import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getFxRates } from "../../../lib/fx";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import ExchangeRatesUI from "./exchange-rates-ui";

export const dynamic = "force-dynamic";

/*
 * Exchange Rates (FINANCE DATA) — the rates Finance converts procurement at,
 * one block per currency against sterling. Three rate types each: SPOT (paid at
 * the point in time), HEDGED (locked in with HSBC), COSTING (the rate stock is
 * valued at). Finance can put a new currency on the desk and edit every rate;
 * read-only for everyone else. The same rates drive the conversion on the
 * Procurement Requests approval step and the trade facility register.
 */
export default async function ExchangeRates() {
  const session = await getSession();
  if (!session) redirect("/login");
  const isFinance = hasRole(session, "ADMIN", "FINANCE");
  const rates = await getFxRates().catch(() => []);

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Finance Data" title="Exchange Rates"
        right="spot / hedged / costing rates against sterling" />
      {!rates.length ? (
        <EmptyState title="One migration to run">
          This screen needs the FX rate table (migration <span style={{ fontFamily: "var(--mono)" }}>085_fx_rates.sql</span>, idempotent). Apply it, refresh, and the rates will appear here.
        </EmptyState>
      ) : (
        <ExchangeRatesUI rates={rates} isFinance={isFinance} />
      )}
    </div>
  );
}

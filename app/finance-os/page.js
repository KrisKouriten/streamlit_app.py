import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { getDashboards } from "../../lib/finance-os";

export const dynamic = "force-dynamic";

const LAYERS = {
  1: "Strategic planning",
  2: "Performance management",
  3: "Operational intelligence",
  4: "Executive intelligence",
};

// Dashboards that have a built screen. Others show as "Coming soon".
const LIVE = {
  MASTER: "/finance-os/executive",
  BUDGET_FORECAST: "/finance-os/budget-forecast",
  MANAGEMENT_ACCOUNTS: "/finance-os/management-accounts",
  STORE_SALES_KPI: "/finance-os/store-sales",
  FRANCHISE: "/finance-os/franchise",
  FIXED_ASSETS: "/finance-os/fixed-assets",
  INVENTORY: "/finance-os/inventory",
  CASHFLOW: "/finance-os/cashflow",
};

export default async function FinanceOsHome() {
  const session = await getSession();
  if (!session) redirect("/login");

  const dashboards = await getDashboards();
  const byLayer = {};
  for (const d of dashboards) (byLayer[d.dashboard_layer] ||= []).push(d);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.75rem" }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>Miniso UK</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Finance Operating System</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13.5, color: "var(--muted)" }}>
          <Link href="/" style={{ textDecoration: "none" }}>Month-end close</Link>
          <span>{session.name}</span>
        </div>
      </header>

      <p style={{ fontSize: 14.5, color: "var(--muted)", marginBottom: 26, maxWidth: 620 }}>
        One connected view of the business. Every dashboard reads from the same
        governed data, so a number means the same thing everywhere.
      </p>

      {[4, 1, 2, 3].map((layer) =>
        byLayer[layer] ? (
          <section key={layer} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--faint)", marginBottom: 10 }}>
              {LAYERS[layer]}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
              {byLayer[layer].map((d) => {
                const href = LIVE[d.dashboard_code];
                const card = (
                  <div style={{
                    background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)",
                    padding: "16px 18px", height: "100%", opacity: href ? 1 : 0.66,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{d.dashboard_name}</div>
                      <span style={{ fontSize: 11, color: href ? "var(--green)" : "var(--faint)", flex: "none" }}>
                        {href ? "Live" : "Coming soon"}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, marginBottom: 12 }}>{d.purpose}</div>
                    <div style={{ fontSize: 12, color: "var(--faint)", display: "flex", gap: 14, flexWrap: "wrap" }}>
                      <span>Owner: {d.finance_owner}</span>
                      <span>{d.refresh_frequency}</span>
                    </div>
                  </div>
                );
                return href ? (
                  <Link key={d.dashboard_code} href={href} style={{ textDecoration: "none", color: "inherit" }}>{card}</Link>
                ) : (
                  <div key={d.dashboard_code}>{card}</div>
                );
              })}
            </div>
          </section>
        ) : null
      )}
    </div>
  );
}

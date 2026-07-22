import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { getConnectedEntities } from "../../lib/finance-os";
import { ProvenanceBadge } from "../finance-os/ui";

export const dynamic = "force-dynamic";

/*
 * DASHBOARDS — the home for the specialist finance dashboards, gathered out of
 * the old PLAN / PERFORM / OPERATE tabs into one place and shown in the order
 * Kris set. Each card declares its data provenance so "is this real?" is legible
 * before you click in. Real feeds first (1–4), illustrative (awaiting a feed) last.
 */
const DASHBOARDS = [
  { n: 1, title: "Management Accounts Dashboard", href: "/dashboards/management-accounts", kind: "feed",
    blurb: "Actual vs forecast — Revenue and EBITDA by scope (Store, Head Office, Franchise) and Group, from the Perform board packs and the Plan Forecast Builder." },
  { n: 2, title: "Budget & Forecast", href: "/finance-os/budget-forecast", kind: "model",
    blurb: "The multi-year plan model — Group P&L, stores, monthly EBITDA and break-even, with connected actuals alongside." },
  { n: 3, title: "Cash Flow", href: "/finance-os/cashflow", kind: "xero",
    blurb: "Consolidated cash position from the connected Xero entities, with bank-reconciliation status." },
  { n: 4, title: "Store Sales & KPI", href: "/finance-os/store-sales", kind: "feed",
    blurb: "Trading across every store — net sales, margin, like-for-like and the governed store KPIs." },
  { n: 5, title: "Inventory", href: "/finance-os/inventory", kind: "illustrative",
    blurb: "Stock value, ageing, weeks-cover, availability and sell-through by category." },
  { n: 6, title: "Franchise", href: "/finance-os/franchise", kind: "illustrative",
    blurb: "Franchise-store sales, receivables, overdue exposure, credit limits and profitability." },
  { n: 7, title: "Fixed Assets", href: "/finance-os/fixed-assets", kind: "illustrative",
    blurb: "The asset register — cost, depreciation, net book value, return and payback." },
];

function Card({ d }) {
  return (
    <Link href={d.href} className="fos-card hover" style={{ padding: "17px 18px", height: "100%", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
          <span className="fos-num" style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--faint)" }}>{String(d.n).padStart(2, "0")}</span>
          <span style={{ fontSize: 15.5, fontWeight: 650, letterSpacing: "-.015em", color: "var(--ink)" }}>{d.title}</span>
        </div>
        <ProvenanceBadge kind={d.kind} />
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>{d.blurb}</div>
    </Link>
  );
}

export default async function Dashboards() {
  const session = await getSession();
  if (!session) redirect("/login");
  const scope = await getConnectedEntities();
  const connected = scope?.count || 0;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ margin: "0.5rem 0 1.9rem" }}>
        <span className="fos-eyebrow">Dashboards</span>
        <h1 style={{ fontSize: 23, fontWeight: 650, letterSpacing: "-.022em", marginTop: 13 }}>Specialist dashboards</h1>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 8, maxWidth: 680, lineHeight: 1.6 }}>
          The finance function's specialist views, in one place. Four run on real feeds — Xero actuals,
          the uploaded plan model and the governed store feed; three carry illustrative figures until their
          feed is connected, and are badged as such. {connected} Xero {connected === 1 ? "entity is" : "entities are"} currently connected.
        </p>
      </header>

      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
        {DASHBOARDS.map((d) => <Card key={d.href} d={d} />)}
      </div>
    </div>
  );
}

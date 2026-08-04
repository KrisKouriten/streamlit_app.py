import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getLoadedActualYears } from "../../../lib/management-accounts";
import { PageHeader, Panel, Badge, EmptyState } from "../../finance-os/ui";
import { InlineUpload } from "./uploaders";

export const dynamic = "force-dynamic";

/*
 * Finance Data — Data Uploads hub (CR: one governed intake). A single home for
 * every governed input that drives the platform: financial statements, management
 * accounts actuals, sales, inventory, treasury and the fixed/variable cost split
 * that benchmarks the month-end close. Live feeds link to their uploader; feeds
 * whose format is not yet pinned show honestly as "awaiting" — never faked.
 */

const LIVE = [
  {
    key: "mgmt-actuals",
    title: "Management Accounts — Actuals",
    drives: "The MA blend (Perform), the dashboards and the Corporate Reporting Centre.",
    detail: "Upload one workbook per fiscal year — 2025, then 2026, and so on. Grain: Entity · Store · Month · Nominal · Value. Each year is a separate load; a new year never overwrites a prior one (upsert is by store · nominal · month).",
    uploads: [{ endpoint: "/api/management-accounts", action: "workbook", fileField: "file", label: "Upload a year's actuals (Excel)" }],
    fullHref: "/finance-os/management-accounts", fullLabel: "View the management accounts →",
  },
  {
    key: "statements",
    title: "Financial Statements — Upload & Refresh",
    drives: "Consolidated board pack, three-statement model, Executive Hub finance tiles.",
    detail: "Upload the by-company P&L workbook and P&L format templates here. The Joiin API refresh and nominal mapping stay on the full screen.",
    uploads: [
      { endpoint: "/api/pl-formats", action: "workbook", fileField: "file", label: "Upload by-company P&L (Excel)" },
      { endpoint: "/api/pl-formats", action: "formatWorkbook", fileField: "file", label: "Upload P&L format template" },
    ],
    fullHref: "/govern/pl-formats", fullLabel: "Joiin refresh & nominal mapping ↗",
  },
  {
    key: "budget-forecast",
    title: "Budget & Forecast",
    drives: "Every budget / forecast comparative across the platform.",
    detail: "The plan model workbook (Forecast Builder also under Plan → Operate).",
    uploads: [{ endpoint: "/api/plan", action: "workbook", fileField: "b64", label: "Upload budget / forecast model (Excel)" }],
    fullHref: "/finance-os/budget-forecast", fullLabel: "Open budget & forecast view ↗",
  },
  {
    key: "cost-model",
    title: "Fixed, Variable & Labour cost model",
    drives: "The Management Accounts Close accrual review — the expected figure per store × nominal (variance versus actuals).",
    detail: "The store cost-assumptions workbook: fixed costs (£/month, with a start month), variable costs (% of sales), the monthly COGS % override, and the seasonal labour chain (Basic Pay → Holiday → NI → Pension). At month-end the accrual review compares this expectation to what's posted; where no model line exists it falls back to the trailing run-rate. A simple long tab (Store · Nominal · Behaviour · Monthly Amount · % of Revenue) is also accepted.",
    uploads: [{ endpoint: "/api/management-accounts", action: "costModel", fileField: "file", label: "Upload cost model (Excel)" }],
    template: { name: "cost-model-simple-template.csv", href: "Store,Nominal,Behaviour,Monthly Amount,% of Revenue\nCamden,ST: Rent,FIXED,12000,\nCamden,ST: Rates,FIXED,3500,\nCamden,ST: Cost of Goods Sold,VARIABLE,,40\nCamden,ST: Card Fees,VARIABLE,,1.5\n" },
    fullHref: "/operate/management-close", fullLabel: "Open the accrual review ↗",
  },
];

const AWAITING = [
  {
    key: "sales",
    title: "Sales data",
    drives: "All store sales & KPI reports (trading).",
    detail: "A self-serve in-app uploader for the weekly/period store-sales export. Today this is loaded outside the app — hand over the column layout and I'll build the uploader.",
  },
  {
    key: "inventory",
    title: "Inventory",
    drives: "Inventory dashboard — stock value, ageing & cover.",
    detail: "Awaiting the stock feed / workbook format.",
  },
  {
    key: "treasury",
    title: "Treasury",
    drives: "Treasury dashboard & the Cash / Treasury report perspective.",
    detail: "Awaiting a bank-facility / forward-cash feed (balances, facility limits, drawn, headroom, forward flows).",
  },
];

const OTHER = [
  ["Forecast inputs", "/operate/forecast"],
  ["SKU analysis", "/finance-os/sku-analysis"],
  ["Intercompany", "/operate/intercompany"],
  ["Procurement", "/operate/procurement"],
];

const cardBase = { border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8, background: "var(--surface)" };

export default async function DataUploads() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canUpload = hasRole(session, "ADMIN", "FINANCE");
  const actualYears = await getLoadedActualYears();

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Finance Data" title="Data Uploads"
        right="One place to load every governed input — the feeds that drive the whole platform." />

      {!canUpload && (
        <div style={{ marginBottom: 18 }}>
          <EmptyState title="View only">Uploading finance data needs finance or admin access. You can see what each feed drives below.</EmptyState>
        </div>
      )}

      <Panel title="Connected feeds" note="upload right here — no need to leave this page">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 14 }}>
          {LIVE.map((f) => (
            <div key={f.key} style={cardBase}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <div style={{ fontSize: 14.5, fontWeight: 650 }}>{f.title}</div>
                <Badge tone="green">Live</Badge>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{f.detail}</div>
              <div style={{ fontSize: 11.5, color: "var(--faint)" }}><strong style={{ color: "var(--muted)" }}>Drives:</strong> {f.drives}</div>
              {f.key === "mgmt-actuals" && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" }}>Years loaded:</span>
                  {actualYears.years.length ? actualYears.years.map((y) => (
                    <Badge key={y.year} tone="accent">{y.year} · {y.months} mo</Badge>
                  )) : <span style={{ fontSize: 11.5, color: "var(--faint)" }}>none yet</span>}
                </div>
              )}
              {canUpload ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                  {f.uploads.map((u, i) => (
                    <InlineUpload key={i} endpoint={u.endpoint} action={u.action} fileField={u.fileField} label={u.label} />
                  ))}
                  {f.template && (
                    <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(f.template.href)}`} download={f.template.name}
                      style={{ fontSize: 11.5, color: "var(--muted)", textDecoration: "none" }}>Download template (CSV) ↓</a>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 4 }}>Finance or admin access needed to upload.</div>
              )}
              <div style={{ marginTop: 2 }}>
                <Link href={f.fullHref} style={{ fontSize: 11.5, textDecoration: "none", color: "var(--muted)" }}>{f.fullLabel}</Link>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Planned feeds" note="awaiting format — hand over the layout and these go live">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
          {AWAITING.map((f) => (
            <div key={f.key} style={{ ...cardBase, borderStyle: "dashed", opacity: 0.92 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <div style={{ fontSize: 14.5, fontWeight: 650 }}>{f.title}</div>
                <Badge tone="amber">Awaiting format</Badge>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{f.detail}</div>
              <div style={{ fontSize: 11.5, color: "var(--faint)" }}><strong style={{ color: "var(--muted)" }}>Will drive:</strong> {f.drives}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Other governed inputs already in-app">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {OTHER.map(([label, href]) => (
            <Link key={href} href={href} style={{ fontSize: 12.5, padding: "6px 12px", borderRadius: 8, textDecoration: "none", color: "var(--muted)", border: "1px solid var(--line)" }}>{label} →</Link>
          ))}
        </div>
      </Panel>

      <p style={{ fontSize: 12, color: "var(--faint)", lineHeight: 1.6, maxWidth: "76ch", marginTop: 8 }}>
        Every feed here is governed: an upload updates the same tables the dashboards, management accounts,
        the month-end close and the Corporate Reporting Centre read from — so one load flows through the
        whole platform. Planned feeds show as "awaiting format" rather than displaying invented figures.
      </p>
    </div>
  );
}

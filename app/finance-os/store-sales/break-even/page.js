import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { getBreakEven, getWindows } from "../../../../lib/store-sales";
import { PageHeader, StatRow, Stat, Panel, Table, SubNav, STORE_SALES_NAV, money, pct, dateLabel } from "../../ui";

export const dynamic = "force-dynamic";

const chip = (status) => {
  const map = { ABOVE: ["var(--green)", "var(--green-bg)"], BELOW: ["#a32d2d", "#f7e6e3"] };
  const [fg, bg] = map[status] || ["var(--muted)", "var(--line)"];
  return <span style={{ fontSize: 10.5, fontWeight: 600, color: fg, background: bg, padding: "2px 8px", borderRadius: 6 }}>{status || "—"}</span>;
};

export default async function BreakEvenBoard() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [rows, wins] = await Promise.all([getBreakEven(), getWindows()]);
  const above = rows.filter((r) => r.ytd_status === "ABOVE");
  const below = rows.filter((r) => r.ytd_status === "BELOW");
  const noData = rows.filter((r) => r.ytd_status !== "ABOVE" && r.ytd_status !== "BELOW");
  const costed = (r) => r.ytd_status === "ABOVE" || r.ytd_status === "BELOW";
  const surplus = rows.reduce((s, r) => s + (costed(r) ? Number(r.ytd_actual) - Number(r.ytd_break_even) : 0), 0);
  const fyAbove = rows.filter((r) => r.fy_status === "ABOVE").length;
  const fyBelow = rows.filter((r) => r.fy_status === "BELOW").length;

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Operational intelligence" title="Store Break-even & EBITDA"
        right={`Data to ${dateLabel(wins.maxDate)}`} />
      <SubNav items={STORE_SALES_NAV} active="/finance-os/store-sales/break-even" />

      <StatRow>
        <Stat label="Above break-even · YTD" value={above.length} tone="green" sub={`${below.length} below · ${noData.length} no cost data`} />
        <Stat label="Aggregate YTD surplus" value={money(surplus, { compact: true })} tone={surplus >= 0 ? "green" : "red"} sub="actual vs break-even, costed stores" />
        <Stat label="Forecast full-year" value={`${fyAbove} above`} sub={`${fyBelow} below at current forecast`} />
      </StatRow>

      <Panel title="Per-store break-even" note="fixed establishment costs ÷ (1 − labour % − variable %); from the costed finance model">
        <Table columns={[
          { label: "Store", render: (r) => <a href={`/finance-os/store-sales/store?store=${encodeURIComponent(r.store_code)}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{r.store_name}</a> },
          { label: "Fixed £/mth", align: "right", render: (r) => (costed(r) ? money(r.monthly_fixed) : "—") },
          { label: "Labour %", align: "right", render: (r) => (r.labour_pct_month != null ? pct(r.labour_pct_month) : "—") },
          { label: "Variable %", align: "right", render: (r) => (r.variable_pct != null ? pct(r.variable_pct) : "—") },
          { label: "YTD actual", align: "right", render: (r) => money(r.ytd_actual) },
          { label: "YTD break-even", align: "right", render: (r) => (costed(r) ? money(r.ytd_break_even) : "—") },
          { label: "+/− £", align: "right",
            tone: (r) => (costed(r) ? (Number(r.ytd_actual) >= Number(r.ytd_break_even) ? "green" : "red") : "muted"),
            render: (r) => (costed(r) ? money(Number(r.ytd_actual) - Number(r.ytd_break_even)) : "—") },
          { label: "YTD", align: "right", render: (r) => chip(r.ytd_status) },
          { label: "FY fcst", align: "right", render: (r) => money(r.fy_forecast) },
          { label: "FY BE", align: "right", render: (r) => (r.fy_status === "ABOVE" || r.fy_status === "BELOW" ? money(r.fy_break_even) : "—") },
          { label: "FY", align: "right", render: (r) => chip(r.fy_status) },
        ]} rows={rows} />
      </Panel>
      <div style={{ fontSize: 12, color: "var(--faint)" }}>
        Cost profiles come from the finance cost model (rates, rent, service charge, labour with seasonality).
        Stores marked NO COST DATA are trading but not yet costed. Franchise-operated stores are excluded — their occupancy costs sit with the franchisee.
      </div>
    </div>
  );
}

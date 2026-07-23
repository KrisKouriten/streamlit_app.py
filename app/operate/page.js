import PillarHub from "../pillar-hub";
export const dynamic = "force-dynamic";
// Fixed-content hub (pillar=null): no registry cards, so the analytical
// dashboards can never reappear here — they live under DASHBOARDS.
// Month-end close moved to WORKFLOW (the team's cadence).
export default function Operate() {
  return <PillarHub pillar={null} title="Operate"
    intro="Operational controls at working grain. The specialist analytical views live under Dashboards; the per-entity close ticks run on the Workflow tab."
    extras={[
      { title: "Forecast inputs", href: "/operate/forecast", purpose: "Populate the forecasts — company stores, head office and franchise: forecast sales, variable rates and fixed costs. The Plan tab runs on these.", meta: "Live · from the Q3 forecast models" },
      { title: "Management accounts close", href: "/operate/management-close", purpose: "Pre-close checks on the real accounts — missed nominals & accrual candidates, fixed-cost drift, sign anomalies — plus the reconciliation playbook.", meta: "Live · real actuals" },
      { title: "Intercompany", href: "/operate/intercompany", purpose: "Intercompany transactions — bank cash, inventory & recharges, disbursements — with reconciliation status.", meta: "Live · CSV or manual" },
    ]} />;
}
